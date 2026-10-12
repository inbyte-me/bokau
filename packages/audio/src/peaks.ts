export interface Peaks {
  min: Float32Array;
  max: Float32Array;
  /** samples per bin */
  spb: number;
  sr: number;
  duration: number;
}

const channels = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));

/** Min/max waveform bins for fast drawing at any zoom. Mono mix of channels. */
export function computePeaks(buffer: AudioBuffer, spb = 128): Peaks {
  const n = buffer.length;
  const bins = Math.ceil(n / spb);
  const min = new Float32Array(bins);
  const max = new Float32Array(bins);
  const chs = channels(buffer);
  for (let b = 0; b < bins; b++) {
    let lo = 1;
    let hi = -1;
    const s = b * spb;
    const e = Math.min(n, s + spb);
    for (const d of chs)
      for (let i = s; i < e; i++) {
        const v = d[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max, spb, sr: buffer.sampleRate, duration: buffer.duration };
}

export interface WaveArea {
  x0: number;
  x1: number;
  y: number;
  h: number;
  /** seconds of the buffer mapped to x0..x1 */
  t0: number;
  t1: number;
  color: string;
  gain?: number;
}

/** Draw a waveform into a 2D context region. */
export function drawWave(ctx: CanvasRenderingContext2D, peaks: Peaks | null | undefined, { x0, x1, y, h, t0, t1, color, gain = 1 }: WaveArea): void {
  if (!peaks) return;
  const w = Math.max(1, Math.round(x1 - x0));
  const mid = y + h / 2;
  const amp = (h / 2) * 0.95 * gain;
  ctx.fillStyle = color;
  const secPerPx = (t1 - t0) / w;
  for (let px = 0; px < w; px++) {
    const a = Math.max(0, Math.floor(((t0 + px * secPerPx) * peaks.sr) / peaks.spb));
    const b = Math.min(peaks.max.length, Math.max(a + 1, Math.ceil(((t0 + (px + 1) * secPerPx) * peaks.sr) / peaks.spb)));
    if (a >= peaks.max.length) break;
    let lo = 1;
    let hi = -1;
    for (let i = a; i < b; i++) {
      if (peaks.min[i] < lo) lo = peaks.min[i];
      if (peaks.max[i] > hi) hi = peaks.max[i];
    }
    const top = mid - Math.min(1, hi) * amp;
    const bot = mid - Math.max(-1, lo) * amp;
    ctx.fillRect(x0 + px, top, 1, Math.max(1, bot - top));
  }
}

/** RMS envelope (linear) at `rate` Hz, used for ducking, lip-flap detection and loudness meters. */
export function rmsEnvelope(buffer: AudioBuffer, rate = 100): Float32Array {
  const hop = Math.round(buffer.sampleRate / rate);
  const n = Math.ceil(buffer.length / hop);
  const out = new Float32Array(n);
  const chs = channels(buffer);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let cnt = 0;
    const a = i * hop;
    const b = Math.min(buffer.length, a + hop);
    for (const d of chs)
      for (let k = a; k < b; k++) {
        s += d[k] * d[k];
        cnt++;
      }
    out[i] = Math.sqrt(s / Math.max(1, cnt));
  }
  return out;
}
