import { rmsEnvelope } from './peaks.js';

const RATE = 100; // Hz

/**
 * Voice-activity driven ducking curve for the background. Because voice clips are known ahead of time we can
 * look ahead: the music dips just BEFORE you start speaking and recovers after you pause.
 *   returns { curve: Float32Array (linear gain @100Hz), rate, duration }
 */
export function computeDuckCurve(project, assets, { duration, audibleTrack }) {
  const n = Math.max(2, Math.ceil(duration * RATE) + 1);
  const active = new Float32Array(n);
  const thr = project.ducking.threshold ?? 0.02;
  for (const t of project.tracks) {
    if (!audibleTrack(t)) continue;
    for (const c of t.clips) {
      const buf = assets.takes.get(c.file); if (!buf) continue;
      const env = assets.envs.get(c.file) || assets.envs.set(c.file, rmsEnvelope(buf, RATE)).get(c.file);
      const i0 = Math.floor(c.offset * RATE), len = Math.floor(c.duration * RATE), at = Math.round((c.start + (t.nudgeMs || 0) / 1000) * RATE);
      for (let i = 0; i < len; i++) {
        const src = env[i0 + i]; const dst = at + i;
        if (src === undefined || dst < 0 || dst >= n) continue;
        if (src * (c.gain ?? 1) * t.volume >= thr) active[dst] = 1;
      }
    }
  }
  const atk = Math.max(0.005, project.ducking.attack ?? 0.04), rel = Math.max(0.02, project.ducking.release ?? 0.35);
  const hold = Math.round(0.2 * RATE), look = Math.round(atk * RATE);
  // hold: bridge gaps between words; lookahead: begin ducking early
  const target = new Float32Array(n).fill(1);
  const floor = 10 ** ((project.ducking.db ?? -12) / 20);
  let lastActive = -1e9;
  const heldActive = new Uint8Array(n);
  for (let i = 0; i < n; i++) { if (active[i]) lastActive = i; heldActive[i] = i - lastActive <= hold ? 1 : 0; }
  for (let i = 0; i < n; i++) { if (heldActive[Math.min(n - 1, i + look)]) target[i] = floor; }
  const curve = new Float32Array(n); let g = 1;
  const aCoef = 1 - Math.exp(-1 / (RATE * atk)), rCoef = 1 - Math.exp(-1 / (RATE * rel));
  for (let i = 0; i < n; i++) { g += (target[i] - g) * (target[i] < g ? aCoef : rCoef); curve[i] = g; }
  return { curve, rate: RATE, duration };
}
