// Round-trip latency measurement: play chirps through the speakers/headphones, hear them on the mic,
// cross-correlate. Works with speakers near the mic (TV!), or an interface loopback / headphone held to the mic.
import type { Engine } from './engine.ts';
import type { Mic } from './mic.ts';

export function makeChirp(sr: number, ms = 50, f0 = 600, f1 = 8000): Float32Array<ArrayBuffer> {
  const n = Math.round((sr * ms) / 1000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const T = n / sr;
    const ph = 2 * Math.PI * (f0 * t + ((f1 - f0) / (2 * T)) * t * t);
    out[i] = Math.sin(ph) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return out;
}

export interface LatencyResult {
  ms: number | null;
  delays: number[];
  confidence: number;
  spreadMs?: number | null;
  agreeing?: number;
  ok: boolean;
}

/**
 * rec: captured mono samples; startFrame: ctx frame of rec[0]; emitFrames: ctx frames where chirps were scheduled.
 * Returns delays in ms for each chirp plus a robust median and a confidence (peak-to-background ratio).
 */
export function measureDelays(
  rec: Float32Array,
  template: Float32Array,
  sr: number,
  startFrame: number,
  emitFrames: number[],
  searchSec = 0.45,
): LatencyResult {
  const M = template.length;
  let tE = 0;
  for (let i = 0; i < M; i++) tE += template[i] * template[i];
  const delays: number[] = [];
  const conf: number[] = [];
  for (const e of emitFrames) {
    const from = Math.max(0, e - startFrame - Math.round(0.05 * sr));
    const to = Math.min(rec.length - M, from + Math.round(searchSec * sr));
    if (to <= from) continue;
    let best = 0;
    let bi = -1;
    let sum = 0;
    let cnt = 0;
    for (let k = from; k < to; k++) {
      let c = 0;
      let wE = 0;
      for (let i = 0; i < M; i += 1) {
        const v = rec[k + i];
        c += v * template[i];
        wE += v * v;
      }
      const a = Math.abs(c / Math.sqrt(tE * wE + 1e-12));
      sum += a;
      cnt++;
      if (a > best) {
        best = a;
        bi = k;
      }
    }
    if (bi < 0) continue;
    delays.push(((startFrame + bi - e) / sr) * 1000);
    conf.push(best / (sum / cnt + 1e-9));
  }
  if (!delays.length) return { ms: null, delays, confidence: 0, ok: false };
  // Trust only a delay that most clicks agree on. Round trips under 3 ms are impossible (cross-talk or room noise).
  const plausible = delays.filter((d) => d >= 3);
  let best: number[] = [];
  for (const d of plausible) {
    const near = plausible.filter((x) => Math.abs(x - d) <= 4);
    if (near.length > best.length) best = near;
  }
  const need = Math.max(3, Math.ceil(delays.length * 0.6));
  const sorted = [...best].sort((a, b) => a - b);
  const ms = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const confidence = conf.reduce((a, b) => a + b, 0) / conf.length;
  const spreadMs = best.length ? Math.max(...best) - Math.min(...best) : null;
  return { ms, delays, confidence, spreadMs, agreeing: best.length, ok: best.length >= need && confidence > 6 };
}

/** Full procedure using the live engine + mic. */
export async function calibrateLatency(engine: Engine, mic: Mic, { count = 6, gap = 0.7 } = {}): Promise<LatencyResult> {
  const ctx = engine.ctx;
  const sr = ctx.sampleRate;
  const chirp = makeChirp(sr);
  await engine.resume();
  const buf = ctx.createBuffer(1, chirp.length, sr);
  buf.copyToChannel(chirp, 0);
  const startFrame = await mic.startCapture();
  const t0 = ctx.currentTime + 0.4;
  const emit: number[] = [];
  for (let k = 0; k < count; k++) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    src.connect(g);
    g.connect(ctx.destination);
    const at = t0 + k * gap;
    src.start(at);
    emit.push(Math.round(at * sr));
  }
  await new Promise((r) => setTimeout(r, (0.4 + count * gap + 1.0) * 1000));
  const rec = await mic.stopCapture();
  return measureDelays(rec, chirp, sr, startFrame, emit, gap - 0.05);
}
