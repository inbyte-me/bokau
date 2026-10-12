// Voice effect chains. Built from plain Web Audio nodes (+ the pitch worklet) so the SAME code runs
// live (preview) and in OfflineAudioContext (export) -> what you hear is what you export.
import type { FxPreset } from '@doblaje/core';
import pitchWorkletUrl from './pitch-worklet.ts?worker&url';

export const FX_INFO: Record<FxPreset, { label: string }> = {
  none: { label: 'Clean' },
  walkie: { label: 'Walkie-Talkie' },
  monster: { label: 'Monster' },
  helium: { label: 'Helium' },
  ghost: { label: 'Ghost' },
};

const loaded = new WeakSet<BaseAudioContext>();
export async function ensureWorklets(ctx: BaseAudioContext): Promise<void> {
  if (loaded.has(ctx)) return;
  await ctx.audioWorklet.addModule(pitchWorkletUrl);
  loaded.add(ctx);
}

const irCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
/** synthetic stereo room/hall impulse response: decaying noise with frequency-dependent damping */
export function makeIR(ctx: BaseAudioContext, seconds = 3.2, decay = 3.2): AudioBuffer {
  const key = `${seconds}:${decay}`;
  let c = irCache.get(ctx);
  if (!c) {
    c = new Map();
    irCache.set(ctx, c);
  }
  const hit = c.get(key);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const env = (1 - t) ** decay;
      const damp = 0.15 + 0.8 * t; // later reflections are darker (high-frequency roll-off)
      lp += (rnd() - lp) * (1 - damp);
      d[i] = lp * env * 1.6;
    }
  }
  c.set(key, buf);
  return buf;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext, seconds = 1): AudioBuffer {
  const hit = noiseCache.get(ctx);
  if (hit) return hit;
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 98765;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    d[i] = (seed / 4294967296) * 2 - 1;
  }
  noiseCache.set(ctx, b);
  return b;
}

function saturator(ctx: BaseAudioContext, drive: number): WaveShaperNode {
  const ws = ctx.createWaveShaper();
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  ws.curve = c;
  ws.oversample = '2x';
  return ws;
}

export interface FxChain {
  input: GainNode;
  output: GainNode;
  /** processing delay the clip must be scheduled early by */
  latencySec: number;
  /** per-clip extras (walkie static bursts) */
  decorate(when: number, dur: number): void;
  nodes: AudioNode[];
}

export function createFx(ctx: BaseAudioContext, preset: FxPreset = 'none', amountIn = 1): FxChain {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const fx: FxChain = { input, output, latencySec: 0, decorate() {}, nodes: [] };
  const chain = (...nodes: AudioNode[]) => {
    let prev: AudioNode = input;
    for (const n of nodes) {
      prev.connect(n);
      prev = n;
    }
    prev.connect(output);
    fx.nodes.push(...nodes);
  };
  const amount = Math.min(1, Math.max(0, amountIn));

  switch (preset) {
    case 'walkie': {
      const filt = (type: BiquadFilterType, f: number) => {
        const b = ctx.createBiquadFilter();
        b.type = type;
        b.frequency.value = f;
        b.Q.value = Math.SQRT1_2; // Butterworth
        return b;
      };
      // 4-pole band-pass like a real radio: two cascaded high-passes (300 Hz) and low-passes (3.4 kHz)
      const sat = saturator(ctx, 1.5 + 5 * amount);
      const post = filt('lowpass', 3600); // tame the harmonics the saturator adds
      const mk = ctx.createGain();
      mk.gain.value = 0.85;
      chain(filt('highpass', 300), filt('highpass', 300), filt('lowpass', 3400), filt('lowpass', 3400), sat, post, mk);
      fx.decorate = (when, dur) => {
        // squelch bursts at key-up / key-down + a faint carrier hiss while "transmitting"
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2200;
        bp.Q.value = 0.6;
        const g = ctx.createGain();
        const peak = 0.05 + 0.2 * amount;
        const hiss = 0.006 + 0.02 * amount;
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(peak, when + 0.004);
        g.gain.exponentialRampToValueAtTime(hiss, when + 0.07);
        g.gain.setValueAtTime(hiss, Math.max(when + 0.07, when + dur - 0.05));
        g.gain.linearRampToValueAtTime(peak, when + dur - 0.045);
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.07);
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx);
        src.loop = true;
        src.connect(bp);
        bp.connect(g);
        g.connect(output);
        src.start(when, Math.random() * 0.5);
        src.stop(when + dur + 0.1);
      };
      break;
    }
    case 'monster':
    case 'helium': {
      const semis = preset === 'monster' ? -(5 + 7 * amount) : 7 + 5 * amount;
      const ps = new AudioWorkletNode(ctx, 'pitch-shifter', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
      });
      (ps.parameters.get('semitones') as AudioParam).value = semis;
      // helium keeps vowels natural, monster gets a bigger "body"
      (ps.parameters.get('formant') as AudioParam).value = preset === 'helium' ? 1 : 0;
      fx.latencySec = 1536 / ctx.sampleRate;
      if (preset === 'monster') {
        const warm = ctx.createBiquadFilter();
        warm.type = 'lowpass';
        warm.frequency.value = 3200 - 1200 * amount;
        warm.Q.value = 0.7;
        const low = ctx.createBiquadFilter();
        low.type = 'lowshelf';
        low.frequency.value = 180;
        low.gain.value = 4 + 4 * amount;
        chain(ps, low, warm, saturator(ctx, 1.2 + 1.5 * amount));
      } else {
        const hs = ctx.createBiquadFilter();
        hs.type = 'highshelf';
        hs.frequency.value = 4500;
        hs.gain.value = 2.5;
        chain(ps, hs);
      }
      break;
    }
    case 'ghost': {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 4800 - 1800 * amount;
      lp.Q.value = 0.5;
      const pre = ctx.createDelay(0.2);
      pre.delayTime.value = 0.035;
      const conv = ctx.createConvolver();
      conv.buffer = makeIR(ctx, 2.2 + 1.8 * amount, 2.6);
      const wet = ctx.createGain();
      wet.gain.value = 0.5 + 0.9 * amount;
      const dry = ctx.createGain();
      dry.gain.value = 0.55 - 0.25 * amount;
      const wlp = ctx.createBiquadFilter();
      wlp.type = 'lowpass';
      wlp.frequency.value = 3500;
      input.connect(lp);
      lp.connect(dry);
      dry.connect(output);
      lp.connect(pre);
      pre.connect(conv);
      conv.connect(wlp);
      wlp.connect(wet);
      wet.connect(output);
      fx.nodes.push(lp, pre, conv, wet, dry, wlp);
      break;
    }
    default:
      input.connect(output);
  }
  return fx;
}

/** Budget-mic restoration chain: rumble filter + gentle leveling. */
export function createMicFix(ctx: BaseAudioContext): { input: AudioNode; output: AudioNode } {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 85;
  hp.Q.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -26;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.006;
  comp.release.value = 0.12;
  const mk = ctx.createGain();
  mk.gain.value = 1.5;
  hp.connect(comp);
  comp.connect(mk);
  return { input: hp, output: mk };
}
