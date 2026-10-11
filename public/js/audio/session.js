import { Emitter, clamp, dbToGain } from '../util.js';
import { carveClips, newId } from '/shared/project.js';
import { encodeWav } from './wav.js';

/**
 * Recording orchestration: countdown (3-2-1-BEEP) -> synchronized playback + capture -> latency-compensated take.
 * Supports punch-in (record only [start,end]) and loop recording (one take per pass).
 */
export class RecordSession extends Emitter {
  constructor({ engine, mic, store }) { super(); Object.assign(this, { engine, mic, store }); this.state = 'idle'; this.stopRequested = false; this.uploads = new Set(); }

  /** await all pending take uploads (export needs them on the server) */
  async flushUploads() { await Promise.allSettled([...this.uploads]); }

  stop() { this.stopRequested = true; this.emit('stop-requested'); }

  /**
   * Jump the playhead while recording (marks). The mic keeps capturing; the capture is split at the jump so that
   * each part is placed on the timeline according to where the picture really was.
   */
  async jump(t) {
    const { engine } = this; t = clamp(t, 0, engine.duration);
    if (this.state === 'countdown') { this._retarget = t; engine.seek(t); return true; }
    if (this.state !== 'recording' || !this._segs) return false;
    const goAt = engine.ctx.currentTime + 0.06;
    this._segs.push({ idx: Math.max(0, Math.round(goAt * engine.ctx.sampleRate) - this._startFrame), start: t, goAt, jumped: true });
    await engine.playAt(t, goAt, { to: engine.duration });
    this.emit('jump', t); return true;
  }

  /**
   * opts: { trackId, start, end?, loop?, cueId? }
   * returns array of take objects created.
   */
  async start({ trackId, start, end = null, loop = false, cueId = null }) {
    if (this.state !== 'idle') throw new Error('already recording');
    const { engine, mic, store } = this;
    if (!mic.isOpen) throw new Error('microphone is not open');
    const ctx = engine.ctx; const sr = ctx.sampleRate;
    const dur = engine.duration;
    start = clamp(start, 0, dur); if (end != null) end = clamp(end, start + 0.1, dur);
    const takes = []; this.stopRequested = false;
    let pass = 0;
    const prevMute = engine.muteOriginal;
    try {
      do {
        const p = store.project; const s = p.settings;
        const preRoll = pass === 0 ? Math.max(0, s.preRoll) : Math.min(1, Math.max(0, s.preRoll)); // later loop passes: short lead-in
        const speakers = s.output === 'speakers';
        engine.muteOriginal = !!s.muteOriginalWhileRecording;
        // 1. show the first frame, get ready
        if (engine.playing) engine.pause();
        engine.seek(start);
        this.state = 'countdown'; this.emit('state', 'countdown', { pass });
        await engine.resume();
        const goAt = ctx.currentTime + preRoll + 0.2;
        engine.scheduleBeeps(goAt, Math.round(preRoll), { beep: s.preRollBeep && preRoll >= 1, goLead: speakers ? 0.16 : 0 });
        this.#countdownTicker(goAt, Math.round(preRoll));
        // 2. start capture a hair before GO; playback is anchored to GO
        await this.#waitUntil(goAt - 0.08);
        if (this.stopRequested) break;
        if (this._retarget != null) { start = this._retarget; this._retarget = null; end = null; }
        const startFrame = await mic.startCapture(); this._startFrame = startFrame; this._segs = [{ idx: 0, start, goAt }];
        await engine.playAt(start, goAt, { to: end ?? dur });
        if (!this.stopRequested) { await this.#waitUntil(goAt); if (preRoll >= 1) this.emit('countdown', 0); }
        this.state = 'recording'; this.emit('state', 'recording', { pass, start, end });
        const liveDuck = engine.handle?.nodes?.liveDuck; const offLevel = this.#liveDucking(liveDuck, p);
        // 3. wait for range end or user stop
        await new Promise((res) => { const a = engine.on('ended', () => { a(); b(); res(); }); const b = this.on('stop-requested', () => { a(); b(); res(); }); });
        offLevel();
        const samples = await mic.stopCapture();
        engine.pause();
        // 4. build the take(s): one per capture segment (a jump to a mark starts a new segment)
        const made = this.#makeTakes({ samples, startFrame, segs: this._segs, end: this._segs.length > 1 ? null : end, sr, trackId, cueId });
        this._segs = null; for (const tk of made) { takes.push(tk); this.emit('take', tk); }
        pass++;
        if (loop && !this.stopRequested) await new Promise((r) => setTimeout(r, 120));
      } while (loop && !this.stopRequested);
    } finally {
      engine.muteOriginal = prevMute; this.state = 'idle'; this.emit('state', 'idle');
      if (mic.capturing) { try { await mic.stopCapture(); } catch {} }
    }
    return takes;
  }

  #waitUntil(ctxTime) { return new Promise((res) => { const f = () => { if (this.stopRequested || this.engine.ctx.currentTime >= ctxTime) res(); else setTimeout(f, 8); }; f(); }); }
  #countdownTicker(goAt, n) {
    let last = -1; const ctx = this.engine.ctx;
    const f = () => {
      if (this.state !== 'countdown') return;
      const r = goAt - ctx.currentTime; const v = r > 0 ? Math.min(n, Math.ceil(r)) : 0;
      if (v !== last && v > 0) { last = v; if (n > 0) this.emit('countdown', v); }
      if (r > -0.2) requestAnimationFrame(f);
    };
    f();
  }
  #liveDucking(node, project) {
    if (!node || !project.ducking.enabled) return () => {};
    const floor = dbToGain(project.ducking.db); let held = 0;
    const off = this.mic.on('level', (l) => {
      const active = l.rms > project.ducking.threshold * 0.8; held = active ? 8 : Math.max(0, held - 1);
      node.gain.setTargetAtTime(held > 0 ? floor : 1, this.engine.ctx.currentTime, held > 0 ? project.ducking.attack : project.ducking.release / 3);
    });
    return () => { off(); try { node.gain.setTargetAtTime(1, this.engine.ctx.currentTime, 0.05); } catch {} };
  }

  #makeTakes({ samples, startFrame, segs, end, sr, trackId, cueId }) {
    const { store, engine } = this;
    const p = store.project; const track = p.tracks.find((t) => t.id === trackId); if (!track) return [];
    const L = Math.max(0, p.latencyMs) / 1000;
    const made = [];
    segs.forEach((seg, i) => {
      const a = Math.min(samples.length, seg.idx), bIdx = i + 1 < segs.length ? Math.min(samples.length, segs[i + 1].idx) : samples.length;
      const c0 = (startFrame + a) / sr; // ctx time of the segment's first sample
      // timeline time of segment sample j (from a): seg.start + (c0 + j/sr - seg.goAt) - L ; keep samples at/after seg.start
      const j0 = Math.max(0, Math.ceil((L + seg.goAt - c0) * sr));
      let jEnd = bIdx - a;
      const clipStart = seg.start + (c0 + j0 / sr - seg.goAt) - L;
      if (end != null && i === 0) jEnd = Math.min(jEnd, j0 + Math.floor((end - clipStart) * sr));
      if (jEnd - j0 < sr * 0.15) return; // accidental tap / tiny fragment
      const data = samples.slice(a + j0, a + jEnd); const duration = data.length / sr;
      const id = newId('k'); const file = `take_${id}.wav`;
      const take = { id, file, start: clipStart, duration, createdAt: new Date().toISOString(), cueId, label: `Take ${track.takes.length + made.length + 1}${segs.length > 1 ? ` (${i + 1}/${segs.length})` : ''}`, latencyMs: Math.round(L * 1000) };
      const buf = engine.ctx.createBuffer(1, data.length, sr); buf.copyToChannel(data, 0); engine.assets.addTake(file, buf);
      made.push({ take, data });
    });
    if (!made.length) return [];
    store.commit('Record take', (pr) => {
      const t = pr.tracks.find((x) => x.id === trackId);
      for (const { take } of made) {
        t.takes.push(take);
        t.clips = [...carveClips(t.clips, take.start, take.start + take.duration), { id: newId('c'), file: take.file, takeId: take.id, start: take.start, offset: 0, duration: take.duration, gain: 1 }].sort((x, y) => x.start - y.start);
      }
    }, ['tracks', 'takes']);
    for (const { take, data } of made) { // upload the dry takes in the background
      const up = fetch(`/api/projects/${p.id}/takes/${take.file}`, { method: 'POST', body: encodeWav([data], sr, 16) }).then((r) => { if (!r.ok) throw new Error('upload ' + r.status); }).catch((e) => { console.error('take upload failed', e); this.emit('upload-error', e); }).finally(() => this.uploads.delete(up));
      this.uploads.add(up);
    }
    return made.map((m) => m.take);
  }
}

/** put an existing take back on the timeline (comping): replaces whatever is on its region */
export function applyTake(store, trackId, takeId) {
  store.commit('Use take', (p) => {
    const t = p.tracks.find((x) => x.id === trackId); const k = t?.takes.find((x) => x.id === takeId); if (!k) return;
    t.clips = [...carveClips(t.clips, k.start, k.start + k.duration), { id: newId('c'), file: k.file, takeId: k.id, start: k.start, offset: 0, duration: k.duration, gain: 1 }].sort((a, b) => a.start - b.start);
  }, ['tracks']);
}
