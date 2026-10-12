import { dbToGain, Emitter, gainToDb } from '@doblaje/core';
import type { CaptureMessage } from './capture-worklet.ts';
import captureWorkletUrl from './capture-worklet.ts?worker&url';
import { analyzeCheck, type LevelSample, type MicCheck } from './mic-check.ts';

export type InputChannel = 'auto' | 'mix' | 'left' | 'right';
export interface MicSettings {
  deviceId: string;
  channel: InputChannel;
  gainDb: number;
  /** echo cancellation (off: dry takes) */
  aec: boolean;
  monitor: boolean;
  monitorPan: number;
}
export interface Level {
  peak: number;
  rms: number;
  clipped: number;
  peakDb?: number;
  rmsDb?: number;
}
export interface MicInfo extends MediaTrackSettings {
  label: string;
}

type MicEvents = {
  level: (l: Level) => void;
  'auto-channel': (ch: InputChannel) => void;
};

/** What Mic needs from the engine: just its AudioContext. */
export interface HasAudioContext {
  readonly ctx: AudioContext;
}

/**
 * Microphone input tuned for cheap mics + USB interfaces:
 *  - raw capture (no echo-cancel / noise-suppression / AGC unless asked) for cleaner dry takes
 *  - pick the interface channel (many 2-in interfaces only have the mic on input 1)
 *  - software trim gain, live peak/RMS meter, clip detection, optional headphone monitoring
 */
export class Mic extends Emitter<MicEvents> {
  readonly engine: HasAudioContext;
  stream: MediaStream | null = null;
  info: MicInfo | null = null;
  chunks: Float32Array[] = [];
  capturing = false;
  last: Level = { peak: 0, rms: 0, clipped: 0 };
  settings: MicSettings = { deviceId: 'default', channel: 'auto', gainDb: 0, aec: false, monitor: false, monitorPan: 0 };
  /** side chosen by "auto" once one input clearly carries the signal */
  autoChannel: InputChannel | null = null;
  #loaded = new WeakSet<BaseAudioContext>();
  #nodes: {
    src: MediaStreamAudioSourceNode;
    split: ChannelSplitterNode;
    mono: GainNode;
    trim: GainNode;
    node: AudioWorkletNode;
    sink: GainNode;
    monGain: GainNode;
    monPan: StereoPannerNode;
    anL: AnalyserNode;
    anR: AnalyserNode;
  } | null = null;
  #recDest: MediaStreamAudioDestinationNode | null = null;
  #chTimer: ReturnType<typeof setInterval> | undefined;
  #startResolve: ((frame: number) => void) | null = null;
  #stopResolve: ((frame: number) => void) | null = null;

  constructor(engine: HasAudioContext) {
    super();
    this.engine = engine;
  }

  static async devices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; labelled: boolean }> {
    let list: MediaDeviceInfo[] = [];
    try {
      list = await navigator.mediaDevices.enumerateDevices();
    } catch {}
    return { inputs: list.filter((d) => d.kind === 'audioinput'), outputs: list.filter((d) => d.kind === 'audiooutput'), labelled: list.some((d) => d.label) };
  }

  async open(settings: Partial<MicSettings> = {}): Promise<MicInfo> {
    Object.assign(this.settings, settings);
    this.close();
    const ctx = this.engine.ctx;
    const s = this.settings;
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: s.deviceId && s.deviceId !== 'default' ? { exact: s.deviceId } : undefined,
        channelCount: { ideal: 2 },
        echoCancellation: s.aec,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: { ideal: 48000 },
        // @ts-expect-error `latency` is a valid constraint in Chrome, missing from lib.dom
        latency: { ideal: 0 },
      },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    const info: MicInfo = { label: track.label, ...track.getSettings() };
    this.info = info;
    if (!this.#loaded.has(ctx)) {
      await ctx.audioWorklet.addModule(captureWorkletUrl);
      this.#loaded.add(ctx);
    }
    const n = {
      src: ctx.createMediaStreamSource(stream),
      split: ctx.createChannelSplitter(2),
      mono: ctx.createGain(),
      trim: ctx.createGain(),
      node: new AudioWorkletNode(ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' }),
      sink: ctx.createGain(),
      monGain: ctx.createGain(),
      monPan: ctx.createStereoPanner(),
      anL: ctx.createAnalyser(),
      anR: ctx.createAnalyser(),
    };
    this.#nodes = n;
    n.sink.gain.value = 0; // keeps the worklet "pulled" without making sound
    n.monGain.gain.value = 0;
    n.anL.fftSize = 2048;
    n.anR.fftSize = 2048;
    n.src.connect(n.split);
    n.split.connect(n.anL, 0);
    if ((info.channelCount || 1) > 1) n.split.connect(n.anR, 1);
    n.mono.connect(n.trim);
    n.trim.connect(n.node);
    n.node.connect(n.sink);
    n.sink.connect(ctx.destination);
    n.trim.connect(n.monGain);
    n.monGain.connect(n.monPan);
    n.monPan.connect(ctx.destination);
    this.#route();
    this.setGainDb(s.gainDb);
    this.setMonitor(s.monitor, s.monitorPan);
    this.autoChannel = null;
    this.#watchChannels();
    n.node.port.onmessage = (e: MessageEvent<CaptureMessage>) => this.#onMsg(e.data);
    return info;
  }

  /** processed mono signal (after channel pick + trim) as a MediaStream, for MediaRecorder */
  get recordStream(): MediaStream {
    if (!this.#nodes) throw new Error('microphone is not open');
    if (!this.#recDest) {
      this.#recDest = this.engine.ctx.createMediaStreamDestination();
      this.#recDest.channelCount = 1;
      this.#nodes.trim.connect(this.#recDest);
    }
    return this.#recDest.stream;
  }
  get channels(): number {
    return this.info?.channelCount || 1;
  }
  /** per-input analysers (left/right of a 2-in interface), for the channel meters */
  get analysers(): { left: AnalyserNode; right: AnalyserNode } | null {
    return this.#nodes ? { left: this.#nodes.anL, right: this.#nodes.anR } : null;
  }

  #route() {
    const n = this.#nodes;
    if (!n) return;
    try {
      n.split.disconnect(n.mono); // keep the per-channel analysers attached
    } catch {}
    const ch = this.settings.channel === 'auto' ? this.autoChannel || 'mix' : this.settings.channel;
    if (this.channels < 2 || ch === 'mix') {
      n.mono.gain.value = this.channels < 2 ? 1 : 0.5;
      n.split.connect(n.mono, 0);
      if (this.channels >= 2) n.split.connect(n.mono, 1);
    } else {
      n.mono.gain.value = 1;
      n.split.connect(n.mono, ch === 'right' ? 1 : 0);
    }
  }

  /**
   * "Auto" on a 2-input interface: budget interfaces usually carry the mic on input 1 only. Mixing a dead input in
   * costs 6 dB and adds its noise, so once one side clearly carries the signal we route just that side.
   */
  #watchChannels() {
    clearInterval(this.#chTimer);
    const n = this.#nodes;
    if (this.channels < 2 || !n) return;
    const buf = new Float32Array(2048);
    const rms = (an: AnalyserNode) => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      return Math.sqrt(sum / buf.length);
    };
    let L = 0;
    let R = 0;
    let count = 0;
    this.#chTimer = setInterval(() => {
      if (!this.stream || this.settings.channel !== 'auto') {
        L = 0;
        R = 0;
        count = 0;
        return;
      }
      L = Math.max(L * 0.9, rms(n.anL));
      R = Math.max(R * 0.9, rms(n.anR));
      count++;
      if (count < 8) return;
      const ratioDb = 20 * Math.log10((L + 1e-9) / (R + 1e-9));
      let pick = this.autoChannel;
      if (Math.max(L, R) > 0.003) pick = ratioDb > 18 ? 'left' : ratioDb < -18 ? 'right' : 'mix';
      if (pick && pick !== this.autoChannel) {
        this.autoChannel = pick;
        this.#route();
        this.emit('auto-channel', pick);
      }
    }, 250);
  }
  setChannel(ch: InputChannel): void {
    this.settings.channel = ch;
    this.#route();
  }
  setGainDb(db: number): void {
    this.settings.gainDb = db;
    this.#nodes?.trim.gain.setTargetAtTime(dbToGain(db), this.engine.ctx.currentTime, 0.02);
  }
  setMonitor(on: boolean, pan = 0): void {
    this.settings.monitor = on;
    this.settings.monitorPan = pan;
    if (!this.#nodes) return;
    this.#nodes.monGain.gain.setTargetAtTime(on ? 1 : 0, this.engine.ctx.currentTime, 0.02);
    this.#nodes.monPan.pan.value = pan;
  }
  close(): void {
    clearInterval(this.#chTimer);
    for (const t of this.stream?.getTracks() || []) t.stop();
    try {
      this.#recDest?.disconnect();
    } catch {}
    this.#recDest = null;
    for (const node of Object.values(this.#nodes || {})) {
      try {
        node.disconnect();
      } catch {}
    }
    this.#nodes = null;
    this.stream = null;
  }
  get isOpen(): boolean {
    return !!this.stream?.active;
  }

  #onMsg(m: CaptureMessage) {
    if (m.type === 'level') {
      this.last = { peak: m.peak, rms: m.rms, clipped: m.clipped, peakDb: gainToDb(m.peak), rmsDb: gainToDb(m.rms) };
      this.emit('level', this.last);
    } else if (m.type === 'data') {
      if (this.capturing) this.chunks.push(m.chunk);
    } else if (m.type === 'started') this.#startResolve?.(m.frame);
    else if (m.type === 'stopped') this.#stopResolve?.(m.frame);
  }

  /** begin capturing; resolves with the exact ctx frame of the first sample */
  startCapture(): Promise<number> {
    const node = this.#nodes?.node;
    if (!node) return Promise.reject(new Error('microphone is not open'));
    this.chunks = [];
    this.capturing = true;
    return new Promise((res) => {
      this.#startResolve = res;
      node.port.postMessage({ type: 'start' });
    });
  }
  async stopCapture(): Promise<Float32Array> {
    const node = this.#nodes?.node;
    if (node)
      await new Promise<number>((res) => {
        this.#stopResolve = res;
        node.port.postMessage({ type: 'stop' });
      });
    await new Promise((r) => setTimeout(r, 15)); // let the final chunk message land
    this.capturing = false;
    const total = this.chunks.reduce((a, c) => a + c.length, 0);
    const out = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    this.chunks = [];
    return out;
  }

  /** Guided mic check: 2 s of silence then 3 s of speech -> advice for a low-budget mic chain. */
  async check({
    silenceSec = 2,
    speakSec = 3,
    onPhase,
  }: {
    silenceSec?: number;
    speakSec?: number;
    onPhase?: (p: 'silence' | 'speak') => void;
  } = {}): Promise<MicCheck> {
    const collect = (sec: number) =>
      new Promise<LevelSample>((res) => {
        const rms: number[] = [];
        let peak = 0;
        let clips = 0;
        const off = this.on('level', (l) => {
          rms.push(l.rms);
          peak = Math.max(peak, l.peak);
          clips += l.clipped;
        });
        setTimeout(() => {
          off();
          res({ rms, peak, clips });
        }, sec * 1000);
      });
    onPhase?.('silence');
    const quiet = await collect(silenceSec);
    onPhase?.('speak');
    const loud = await collect(speakSec);
    return analyzeCheck(quiet, loud);
  }
}
