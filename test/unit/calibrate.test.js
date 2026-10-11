import test from 'node:test';
import assert from 'node:assert/strict';
import { makeChirp, measureDelays } from '../../public/js/audio/calibrate.js';
import { analyzeCheck } from '../../public/js/audio/mic.js';

const SR = 48000;
function synth(delayMs, { noise = 0.02, n = SR * 4, startFrame = 100000, emitAt = [0.4, 0.9, 1.4, 1.9, 2.4], gain = 0.3, seed = 1 } = {}) {
  const chirp = makeChirp(SR); const rec = new Float32Array(n); let s = seed;
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; rec[i] = ((s / 4294967296) * 2 - 1) * noise; }
  const emit = [];
  for (const t of emitAt) {
    const e = Math.round(t * SR) + startFrame + 5000; emit.push(e);
    const at = e - startFrame + Math.round((delayMs / 1000) * SR);
    for (let i = 0; i < chirp.length; i++) if (at + i < n) rec[at + i] += chirp[i] * gain;
  }
  return { rec, chirp, emit, startFrame };
}

test('latency measurement recovers the true round-trip delay', () => {
  for (const d of [12, 48.5, 120, 260, 340]) {
    const { rec, chirp, emit, startFrame } = synth(d);
    const r = measureDelays(rec, chirp, SR, startFrame, emit);
    assert.ok(Math.abs(r.ms - d) < 0.1, `delay ${d}: measured ${r.ms}`);
    assert.ok(r.ok, 'confident');
  }
});

test('latency measurement flags a silent/noise-only recording as unreliable', () => {
  const { rec, chirp, emit, startFrame } = synth(100, { gain: 0 });
  const r = measureDelays(rec, chirp, SR, startFrame, emit);
  assert.ok(!r.ok);
});

test('latency measurement survives loud background noise', () => {
  const { rec, chirp, emit, startFrame } = synth(85, { noise: 0.12, gain: 0.35 });
  const r = measureDelays(rec, chirp, SR, startFrame, emit);
  assert.ok(Math.abs(r.ms - 85) < 0.5, 'measured ' + r.ms);
});

test('mic check advice for budget mics', () => {
  const mk = (noise, speech, peak, clips = 0) => analyzeCheck({ rms: Array(40).fill(noise) }, { rms: Array(60).fill(speech), peak, clips });
  assert.deepEqual(mk(0.002, 0.1, 0.5).advice, ['good']);
  assert.ok(mk(0.002, 0.3, 1, 12).advice.includes('clipping'));
  assert.ok(mk(0.001, 0.004, 0.02).advice.includes('too-quiet'));
  assert.ok(mk(0.02, 0.1, 0.5).advice.includes('noisy'));
  assert.deepEqual(mk(0, 0, 0.001).advice, ['silent']);
  const g = mk(0.001, 0.05, 0.1); assert.ok(g.suggestedGainDb > 0 && g.suggestedGainDb < 20, 'suggests boost: ' + g.suggestedGainDb);
});
