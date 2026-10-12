import assert from 'node:assert/strict';
import test from 'node:test';
import { makeChirp, measureDelays } from '../src/calibrate.ts';
import { analyzeCheck } from '../src/mic-check.ts';

const SR = 48000;
function synth(delayMs, { noise = 0.02, n = SR * 5, startFrame = 100000, emitAt = [0.4, 1.1, 1.8, 2.5, 3.2], gain = 0.3, seed = 1 } = {}) {
  const chirp = makeChirp(SR);
  const rec = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    rec[i] = ((s / 4294967296) * 2 - 1) * noise;
  }
  const emit: number[] = [];
  for (const t of emitAt) {
    const e = Math.round(t * SR) + startFrame + 5000;
    emit.push(e);
    const at = e - startFrame + Math.round((delayMs / 1000) * SR);
    for (let i = 0; i < chirp.length; i++) if (at + i < n) rec[at + i] += chirp[i] * gain;
  }
  return { rec, chirp, emit, startFrame };
}

test('latency measurement recovers the true round-trip delay', () => {
  for (const d of [12, 48.5, 120, 260, 340]) {
    const { rec, chirp, emit, startFrame } = synth(d);
    const r = measureDelays(rec, chirp, SR, startFrame, emit);
    assert.ok(Math.abs(r.ms! - d) < 0.1, `delay ${d}: measured ${r.ms}`);
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
  assert.ok(Math.abs(r.ms! - 85) < 0.5, `measured ${r.ms}`);
});

test('mic check advice for budget mics', () => {
  const mk = (noise, speech, peak, clips = 0) =>
    analyzeCheck({ rms: Array(40).fill(noise), peak: noise, clips: 0 }, { rms: Array(60).fill(speech), peak, clips });
  assert.deepEqual(mk(0.002, 0.1, 0.5).advice, ['good']);
  assert.ok(mk(0.002, 0.3, 1, 12).advice.includes('clipping'));
  assert.ok(mk(0.001, 0.004, 0.02).advice.includes('too-quiet'));
  assert.ok(mk(0.02, 0.1, 0.5).advice.includes('noisy'));
  assert.deepEqual(mk(0, 0, 0.001).advice, ['silent']);
  const g = mk(0.001, 0.05, 0.1);
  assert.ok(g.suggestedGainDb > 0 && g.suggestedGainDb < 20, `suggests boost: ${g.suggestedGainDb}`);
});

test('latency measurement ignores impossible round trips and a minority of corrupted clicks', () => {
  const { rec, chirp, emit, startFrame } = synth(90);
  // wreck two of five clicks with loud noise bursts (e.g. someone talking)
  let s = 7;
  for (const k of [1, 3]) {
    const a = emit[k] - startFrame;
    for (let i = 0; i < SR * 0.6; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      rec[a + i] = (rec[a + i] || 0) + ((s / 4294967296) * 2 - 1) * 0.5;
    }
  }
  const r = measureDelays(rec, chirp, SR, startFrame, emit, 0.65);
  assert.ok(Math.abs(r.ms! - 90) < 1, `still finds 90 ms: ${JSON.stringify({ ms: r.ms, d: r.delays })}`);
  assert.ok(r.ok && (r.agreeing ?? 0) >= 3);
  // scattered garbage is rejected
  const bad = measureDelays(
    rec.map(() => (Math.random() - 0.5) * 0.2),
    chirp,
    SR,
    startFrame,
    emit,
    0.65,
  );
  assert.equal(bad.ok, false);
});
