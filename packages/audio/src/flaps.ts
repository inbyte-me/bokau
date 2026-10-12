import type { TimeRange } from '@doblaje/core';

/**
 * Mouth-open intervals from a dialogue envelope (RMS @ rate Hz): hysteresis threshold relative to the loud parts,
 * short gaps bridged (consonant closures inside a word), tiny blips dropped.
 */
export function detectFlaps(env: Float32Array, rate = 100, { openRel = 0.18, closeRel = 0.1, minOpen = 0.09, bridge = 0.07 } = {}): TimeRange[] {
  const sorted = Float32Array.from(env).sort();
  const ref = sorted[Math.floor(sorted.length * 0.95)] || 0;
  if (ref < 0.003) return [];
  const hi = ref * openRel;
  const lo = ref * closeRel;
  const out: [number, number][] = [];
  let open = -1;
  for (let i = 0; i < env.length; i++) {
    if (open < 0 && env[i] > hi) open = i;
    else if (open >= 0 && env[i] < lo) {
      out.push([open / rate, i / rate]);
      open = -1;
    }
  }
  if (open >= 0) out.push([open / rate, env.length / rate]);
  const merged: [number, number][] = [];
  for (const iv of out) {
    const l = merged[merged.length - 1];
    if (l && iv[0] - l[1] < bridge) l[1] = iv[1];
    else merged.push([...iv]);
  }
  return merged.filter(([a, b]) => b - a >= minOpen).map(([start, end]) => ({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 }));
}
