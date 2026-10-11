import { Emitter, clamp } from '../util.js';
import { buildMix } from './mixgraph.js';
import { ensureWorklets } from './fx.js';
import { Assets } from './assets.js';

/**
 * Live transport. The AudioContext clock is the master; the <video> element (muted, video only)
 * is slaved to it with drift correction. All audio comes from the shared mix graph.
 */
export class Engine extends Emitter {
  constructor() {
    super();
    this.ctx = null; this.assets = null; this.project = null; this.video = null;
    this.playing = false; this.t0 = 0; this.anchor = 0; this.handle = null; this.endAt = null;
    this.avOffset = 0; // seconds; positive delays the picture
    this.muteOriginal = false;
    this._raf = 0; this._duration = 0;
  }

  async init() {
    if (this.ctx) return this.ctx;
    this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await ensureWorklets(this.ctx);
    this.out = this.ctx.createGain(); this.out.connect(this.ctx.destination);
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 1024; this.out.connect(this.analyser);
    return this.ctx;
  }

  async load(project, video) {
    await this.init();
    this.stop();
    this.project = project; this.video = video;
    if (video) { video.muted = true; video.playsInline = true; }
    this.assets = new Assets(this.ctx, project.id);
    await this.assets.loadOriginal();
    if (project.stems?.status === 'ready') { try { await this.assets.loadStems(); } catch (e) { console.warn('stems', e); } }
    await this.assets.ensureTakes(project);
    this._duration = project.media.duration;
    this.assets.totalDuration = this._duration;
    this.t0 = 0; this.emit('time', 0);
    return this.assets;
  }
  get duration() { return this._duration; }
  get outputLatency() { return (this.ctx?.outputLatency || 0) + (this.ctx?.baseLatency || 0); }

  /** current timeline position in seconds */
  get time() { return this.playing ? clamp(this.t0 + (this.ctx.currentTime - this.anchor), 0, this._duration) : this.t0; }

  async resume() { if (this.ctx.state !== 'running') await this.ctx.resume(); }

  async #start(from, when, { to = this._duration, include, voiceMode = 'wet', ducking = true } = {}) {
    this.handle?.stop();
    const inc = include || { original: true, voices: true, ghost: !!this.project.original.ghost.enabled };
    this.handle = await buildMix(this.ctx, this.project, { ...this.assets, totalDuration: this._duration }, { from, to, when, include: inc, voiceMode, ducking, destination: this.out, muteOriginal: this.muteOriginal, totalDuration: this._duration });
    this.handle.nodes.liveDuck && (this.liveDuck = this.handle.nodes.liveDuck);
    this.endAt = to;
  }

  /** start playback of timeline position `from` at ctx time `when` (default: ~now) */
  async playAt(from, when, opts = {}) {
    await this.resume();
    from = clamp(from, 0, this._duration);
    when ??= this.ctx.currentTime + 0.06;
    await this.#start(from, when, opts);
    this.t0 = from; this.anchor = when; this.playing = true;
    this.video && this.#videoStart(from, when);
    this.emit('play', from);
    this.#loop();
    return when;
  }
  async play(from = this.t0, opts) { if (from >= this._duration - 0.05) from = 0; return this.playAt(from, undefined, opts); }

  pause() {
    if (!this.playing) return;
    const t = this.time; this.playing = false; this.t0 = t;
    this.handle?.stop(); this.handle = null; cancelAnimationFrame(this._raf);
    if (this.video) { this.video.pause(); this.video.playbackRate = 1; this.#showFrame(t); }
    this.emit('pause', t); this.emit('time', t);
  }
  stop() { if (this.playing) this.pause(); this.handle?.stop(); this.handle = null; }
  toggle() { return this.playing ? this.pause() : this.play(); }

  seek(t) {
    t = clamp(t, 0, this._duration);
    if (this.playing) { this.playAt(t, undefined, this._lastOpts); } else { this.t0 = t; this.#showFrame(t); }
    this.emit('time', t);
  }
  /** rebuild graph at the same position after structural edits (clips, fx preset, stems) */
  async refresh() { if (this.playing) { const t = this.time; await this.playAt(t, undefined, this._lastOpts); } }
  applyLevels() { this.handle?.applyLevels(this.project); }

  stepFrame(dir) {
    if (this.playing) this.pause();
    const fps = this.project.media.fps || 25;
    const f = Math.round(this.t0 * fps - 0.5) + dir;
    this.seek(clamp((f + 0.5) / fps, 0, this._duration));
  }

  #showFrame(t) { if (this.video && Number.isFinite(t)) { try { this.video.currentTime = t; } catch {} } }
  #videoStart(from, when) {
    const v = this.video; v.playbackRate = 1;
    try { v.currentTime = clamp(from - this.outputLatency + this.avOffset, 0, this._duration); } catch {}
    const go = () => v.play().catch((e) => console.warn('video play', e.message));
    const delay = Math.max(0, (when - this.ctx.currentTime) * 1000 - 20);
    setTimeout(() => this.playing && go(), delay);
  }

  #loop = () => {
    cancelAnimationFrame(this._raf);
    const tick = () => {
      if (!this.playing) return;
      const t = this.time;
      this.emit('time', t);
      const v = this.video;
      if (v && !v.paused && this.ctx.currentTime >= this.anchor) {
        const target = clamp(t - this.outputLatency + this.avOffset, 0, this._duration);
        const drift = v.currentTime - target;
        if (Math.abs(drift) > 0.15) { try { v.currentTime = target + 0.04; } catch {} }
        else if (Math.abs(drift) > 0.025) v.playbackRate = 1 - clamp(drift * 0.6, -0.06, 0.06);
        else if (v.playbackRate !== 1) v.playbackRate = 1;
      }
      if (this.endAt != null && t >= this.endAt - 0.005) { this.emit('ended', t); if (this.playing && t >= this._duration - 0.005) { this.pause(); this.t0 = this._duration; this.emit('time', this.t0); } return; }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  };

  /** play only a range then stop (audition a take, loop playback). Resolves when done. */
  async playRange(from, to, opts = {}) {
    this._lastOpts = { ...opts, to };
    await this.playAt(from, undefined, this._lastOpts);
    return new Promise((res) => { const off = this.on('ended', () => { off(); this.pause(); this.t0 = from; res(); }); const off2 = this.on('pause', () => { off(); off2(); res(); }); });
  }

  async setOutputDevice(deviceId) {
    if (this.ctx.setSinkId) await this.ctx.setSinkId(deviceId === 'default' ? '' : deviceId);
  }

  /** scheduled countdown beeps; returns the ctx time at which "GO" lands */
  scheduleBeeps(goAt, count = 3, { beep = true, goLead = 0 } = {}) {
    if (!beep) return;
    const ctx = this.ctx;
    for (let i = 0; i <= count; i++) {
      const isGo = i === count; const at = goAt - (count - i) - (isGo ? goLead : 0);
      if (at < ctx.currentTime) continue;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = isGo ? 1320 : 660;
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.35, at + 0.005); g.gain.setValueAtTime(0.35, at + (isGo ? 0.1 : 0.07)); g.gain.linearRampToValueAtTime(0, at + (isGo ? 0.14 : 0.09));
      o.connect(g); g.connect(this.out); o.start(at); o.stop(at + 0.2);
    }
  }
}
export const engine = new Engine();
