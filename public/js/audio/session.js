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
        const startFrame = await mic.startCapture();
        await engine.playAt(start, goAt, { to: end ?? dur });
        this.state = 'recording'; this.emit('state', 'recording', { pass, start, end });
        const liveDuck = engine.handle?.nodes?.liveDuck; const offLevel = this.#liveDucking(liveDuck, p);
        // 3. wait for range end or user stop
        await new Promise((res) => { const a = engine.on('ended', () => { a(); b(); res(); }); const b = this.on('stop-requested', () => { a(); b(); res(); }); });
        offLevel();
        const stopTime = engine.time;
        const samples = await mic.stopCapture();
        engine.pause();
        // 4. build the take
        const take = this.#makeTake({ samples, startFrame, goAt, start, end, stopTime, sr, trackId, cueId });
        if (take) { takes.push(take.take); this.emit('take', take.take); }
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
      const left = Math.ceil(goAt - ctx.currentTime - 0.02);
      if (left !== last && left >= 0) { last = left; this.emit('countdown', left > n ? n : left); }
      if (ctx.currentTime < goAt) requestAnimationFrame(f);
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

  #makeTake({ samples, startFrame, goAt, start, end, sr, trackId, cueId }) {
    const { store, engine } = this;
    const p = store.project; const track = p.tracks.find((t) => t.id === trackId); if (!track) return null;
    const L = Math.max(0, p.latencyMs) / 1000;
    const c0 = startFrame / sr;
    // timeline time of sample j: start + (c0 + j/sr - goAt) - L. Keep samples from timeline >= start.
    let j0 = Math.max(0, Math.ceil((L + goAt - c0) * sr));
    let jEnd = samples.length;
    const clipStart = start + (c0 + j0 / sr - goAt) - L;
    if (end != null) jEnd = Math.min(jEnd, j0 + Math.floor((end - clipStart) * sr));
    if (jEnd - j0 < sr * 0.15) return null; // accidental tap
    const data = samples.slice(j0, jEnd); const duration = data.length / sr;
    const id = newId('k'); const file = `take_${id}.wav`;
    const take = { id, file, start: clipStart, duration, createdAt: new Date().toISOString(), cueId, label: `Take ${track.takes.length + 1}`, latencyMs: Math.round(L * 1000) };
    engine.assets.addTake(file, (() => { const b = engine.ctx.createBuffer(1, data.length, sr); b.copyToChannel(data, 0); return b; })());
    store.commit('Record take', (pr) => {
      const t = pr.tracks.find((x) => x.id === trackId);
      t.takes.push(take);
      t.clips = [...carveClips(t.clips, take.start, take.start + take.duration), { id: newId('c'), file, takeId: id, start: take.start, offset: 0, duration, gain: 1 }].sort((a, b) => a.start - b.start);
    }, ['tracks', 'takes']);
    // upload dry take in the background
    const blob = encodeWav([data], sr, 16);
    const up = fetch(`/api/projects/${p.id}/takes/${file}`, { method: 'POST', body: blob }).then((r) => { if (!r.ok) throw new Error('upload ' + r.status); }).catch((e) => { console.error('take upload failed', e); this.emit('upload-error', e); }).finally(() => this.uploads.delete(up));
    this.uploads.add(up);
    return { take };
  }
}

/** put an existing take back on the timeline (comping): replaces whatever is on its region */
export function applyTake(store, trackId, takeId) {
  store.commit('Use take', (p) => {
    const t = p.tracks.find((x) => x.id === trackId); const k = t?.takes.find((x) => x.id === takeId); if (!k) return;
    t.clips = [...carveClips(t.clips, k.start, k.start + k.duration), { id: newId('c'), file: k.file, takeId: k.id, start: k.start, offset: 0, duration: k.duration, gain: 1 }].sort((a, b) => a.start - b.start);
  }, ['tracks']);
}
