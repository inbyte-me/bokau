import { clamp, Emitter, type Project } from '@doblaje/core';
import { Assets } from './assets.ts';
import { ensureWorklets } from './fx.ts';
import { buildMix, type MixHandle, type MixInclude } from './mixgraph.ts';

export interface PlayOptions {
  to?: number;
  include?: MixInclude;
  voiceMode?: 'wet' | 'dry';
  ducking?: boolean;
}

type EngineEvents = {
  time: (t: number) => void;
  play: (from: number) => void;
  pause: (t: number) => void;
  ended: (t: number) => void;
};

/**
 * Live transport. The AudioContext clock is the master; the <video> element (muted, video only)
 * is slaved to it with drift correction. All audio comes from the shared mix graph.
 */
export class Engine extends Emitter<EngineEvents> {
  #ctx: AudioContext | null = null;
  assets: Assets | null = null;
  project: Project | null = null;
  video: HTMLVideoElement | null = null;
  out: GainNode | null = null;
  analyser: AnalyserNode | null = null;
  handle: MixHandle | null = null;
  liveDuck: GainNode | null = null;
  playing = false;
  /** timeline position at `anchor` */
  t0 = 0;
  /** ctx time at which t0 sounded */
  anchor = 0;
  endAt: number | null = null;
  /** seconds; positive delays the picture */
  avOffset = 0;
  muteOriginal = false;
  #raf = 0;
  #duration = 0;
  #lastOpts: PlayOptions | undefined;

  /** The AudioContext; only valid after init(). */
  get ctx(): AudioContext {
    if (!this.#ctx) throw new Error('audio engine not initialised');
    return this.#ctx;
  }
  get initialised(): boolean {
    return !!this.#ctx;
  }

  async init(): Promise<AudioContext> {
    if (this.#ctx) return this.#ctx;
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this.#ctx = ctx;
    await ensureWorklets(ctx);
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.out.connect(this.analyser);
    return ctx;
  }

  async load(project: Project, video: HTMLVideoElement | null): Promise<Assets> {
    const ctx = await this.init();
    this.stop();
    this.project = project;
    this.video = video;
    if (video) {
      video.muted = true;
      video.playsInline = true;
    }
    const assets = new Assets(ctx, project.id);
    this.assets = assets;
    await assets.loadOriginal();
    if (project.stems?.status === 'ready') {
      try {
        await assets.loadStems();
      } catch (e) {
        console.warn('stems', e);
      }
    }
    await assets.ensureTakes(project);
    this.#duration = project.media?.duration || 0;
    assets.totalDuration = this.#duration;
    this.t0 = 0;
    this.emit('time', 0);
    return assets;
  }
  get duration(): number {
    return this.#duration;
  }
  get outputLatency(): number {
    return (this.#ctx?.outputLatency || 0) + (this.#ctx?.baseLatency || 0);
  }

  /** current timeline position in seconds */
  get time(): number {
    return this.playing ? clamp(this.t0 + (this.ctx.currentTime - this.anchor), 0, this.#duration) : this.t0;
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  async #start(from: number, when: number, { to = this.#duration, include, voiceMode = 'wet', ducking = true }: PlayOptions = {}) {
    const project = this.project;
    const assets = this.assets;
    if (!project || !assets || !this.out) throw new Error('nothing loaded');
    this.handle?.stop();
    const inc = include || { original: true, voices: true, ghost: !!project.original.ghost.enabled };
    this.handle = await buildMix(this.ctx, project, assets, {
      from,
      to,
      when,
      include: inc,
      voiceMode,
      ducking,
      destination: this.out,
      muteOriginal: this.muteOriginal,
      totalDuration: this.#duration,
    });
    if (this.handle.nodes.liveDuck) this.liveDuck = this.handle.nodes.liveDuck;
    this.endAt = to;
  }

  /** start playback of timeline position `from` at ctx time `when` (default: ~now) */
  async playAt(fromIn: number, whenIn?: number, opts: PlayOptions = {}): Promise<number> {
    await this.resume();
    const from = clamp(fromIn, 0, this.#duration);
    const when = whenIn ?? this.ctx.currentTime + 0.06;
    await this.#start(from, when, opts);
    this.t0 = from;
    this.anchor = when;
    this.playing = true;
    if (this.video) this.#videoStart(this.video, from, when);
    this.emit('play', from);
    this.#loop();
    return when;
  }
  async play(fromIn = this.t0, opts?: PlayOptions): Promise<number> {
    return this.playAt(fromIn >= this.#duration - 0.05 ? 0 : fromIn, undefined, opts);
  }

  pause(): void {
    if (!this.playing) return;
    const t = this.time;
    this.playing = false;
    this.t0 = t;
    this.handle?.stop();
    this.handle = null;
    cancelAnimationFrame(this.#raf);
    if (this.video) {
      this.video.pause();
      this.video.playbackRate = 1;
      this.#showFrame(t);
    }
    this.emit('pause', t);
    this.emit('time', t);
  }
  stop(): void {
    if (this.playing) this.pause();
    this.handle?.stop();
    this.handle = null;
  }
  toggle(): void {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(tIn: number): void {
    const t = clamp(tIn, 0, this.#duration);
    if (this.playing) void this.playAt(t, undefined, this.#lastOpts);
    else {
      this.t0 = t;
      this.#showFrame(t);
    }
    this.emit('time', t);
  }
  /** rebuild the graph at the same position after structural edits (clips, fx preset, stems) */
  async refresh(): Promise<void> {
    if (this.playing) await this.playAt(this.time, undefined, this.#lastOpts);
  }
  applyLevels(): void {
    if (this.project) this.handle?.applyLevels(this.project);
  }

  stepFrame(dir: number): void {
    if (this.playing) this.pause();
    const fps = this.project?.media?.fps || 25;
    const f = Math.round(this.t0 * fps - 0.5) + dir;
    this.seek(clamp((f + 0.5) / fps, 0, this.#duration));
  }

  #showFrame(t: number) {
    if (!this.video || !Number.isFinite(t)) return;
    try {
      this.video.currentTime = t;
    } catch {}
  }
  #videoStart(v: HTMLVideoElement, from: number, when: number) {
    v.playbackRate = 1;
    try {
      v.currentTime = clamp(from - this.outputLatency + this.avOffset, 0, this.#duration);
    } catch {}
    const delay = Math.max(0, (when - this.ctx.currentTime) * 1000 - 20);
    setTimeout(() => {
      if (this.playing) v.play().catch((e: Error) => console.warn('video play', e.message));
    }, delay);
  }

  #loop() {
    cancelAnimationFrame(this.#raf);
    const tick = () => {
      if (!this.playing) return;
      const t = this.time;
      this.emit('time', t);
      const v = this.video;
      if (v && !v.paused && this.ctx.currentTime >= this.anchor) {
        const target = clamp(t - this.outputLatency + this.avOffset, 0, this.#duration);
        const drift = v.currentTime - target;
        if (Math.abs(drift) > 0.15) {
          try {
            v.currentTime = target + 0.04;
          } catch {}
        } else if (Math.abs(drift) > 0.025) v.playbackRate = 1 - clamp(drift * 0.6, -0.06, 0.06);
        else if (v.playbackRate !== 1) v.playbackRate = 1;
      }
      if (this.endAt != null && t >= this.endAt - 0.005) {
        this.emit('ended', t);
        if (this.playing && t >= this.#duration - 0.005) {
          this.pause();
          this.t0 = this.#duration;
          this.emit('time', this.t0);
        }
        return;
      }
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }

  /** play only a range then stop (audition a take, loop playback). Resolves when done. */
  async playRange(from: number, to: number, opts: PlayOptions = {}): Promise<void> {
    this.#lastOpts = { ...opts, to };
    await this.playAt(from, undefined, this.#lastOpts);
    return new Promise((res) => {
      const off = this.on('ended', () => {
        off();
        off2();
        this.pause();
        this.t0 = from;
        res();
      });
      const off2 = this.on('pause', () => {
        off();
        off2();
        res();
      });
    });
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (ctx.setSinkId) await ctx.setSinkId(deviceId === 'default' ? '' : deviceId);
  }

  /** scheduled countdown beeps ending with a higher "GO" beep at `goAt` (ctx time) */
  scheduleBeeps(goAt: number, count = 3, { beep = true, goLead = 0 } = {}): void {
    if (!beep || !this.out) return;
    const ctx = this.ctx;
    for (let i = 0; i <= count; i++) {
      const isGo = i === count;
      const at = goAt - (count - i) - (isGo ? goLead : 0);
      if (at < ctx.currentTime) continue;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = isGo ? 1320 : 660;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.35, at + 0.005);
      g.gain.setValueAtTime(0.35, at + (isGo ? 0.1 : 0.07));
      g.gain.linearRampToValueAtTime(0, at + (isGo ? 0.14 : 0.09));
      o.connect(g);
      g.connect(this.out);
      o.start(at);
      o.stop(at + 0.2);
    }
  }
}
