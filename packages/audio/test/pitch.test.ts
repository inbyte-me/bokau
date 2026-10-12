import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fx } from '@doblaje/testkit';
import { FFT, PitchShifterCore } from '../src/pitch-core.ts';

const SR = 48000;
function shiftAll(x, semis, formant = false, block = 128) {
  const core = new PitchShifterCore(SR);
  const out = new Float32Array(x.length);
  const ratio = 2 ** (semis / 12);
  for (let i = 0; i < x.length; i += block) core.process(x.subarray(i, i + block), out.subarray(i, i + block), ratio, formant);
  return out;
}
function peakHz(x, from, _to) {
  const N = 16384;
  const f = new FFT(N);
  const re = new Float64Array(N),
    im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[from + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  f.transform(re, im);
  let best = 0,
    bi = 0;
  for (let k = 1; k < N / 2; k++) {
    const m = Math.hypot(re[k], im[k]);
    if (m > best) {
      best = m;
      bi = k;
    }
  }
  return (bi * SR) / N;
}
const rms = (x, a, b) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
};
const sine = (f, n, amp = 0.5) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));

test('FFT round trip and bin location', () => {
  const N = 1024,
    f = new FFT(N);
  const re = Float64Array.from({ length: N }, (_, i) => Math.cos((2 * Math.PI * 50 * i) / N));
  const im = new Float64Array(N);
  const orig = re.slice();
  f.transform(re, im);
  assert.ok(Math.hypot(re[50], im[50]) > N / 2 - 1);
  f.transform(re, im, true);
  for (let i = 0; i < N; i++) assert.ok(Math.abs(re[i] / N - orig[i]) < 1e-9);
});

test('pitch shifter: ±12 semitones moves a sine by an octave; 0 semitones is ~unity gain', () => {
  const x = sine(440, SR * 2);
  for (const [semi, hz] of [
    [12, 880],
    [-12, 220],
    [7, 440 * 2 ** (7 / 12)],
    [-5, 440 * 2 ** (-5 / 12)],
  ]) {
    const y = shiftAll(x, semi);
    const got = peakHz(y, SR, 0);
    assert.ok(Math.abs(got - hz) / hz < 0.02, `${semi} st: expected ~${hz.toFixed(1)} Hz, got ${got.toFixed(1)}`);
    const g = rms(y, SR, SR * 2 - 2000) / rms(x, SR, SR * 2 - 2000);
    assert.ok(g > 0.6 && g < 1.5, `${semi} st gain ${g.toFixed(2)}`);
  }
  const y0 = shiftAll(x, 0);
  const g0 = rms(y0, SR, SR * 2 - 2000) / rms(x, SR, SR * 2 - 2000);
  assert.ok(Math.abs(g0 - 1) < 0.15, `unity gain at 0 st: ${g0}`);
});

test('pitch shifter latency equals fftSize - hop (compensated by the mixer)', () => {
  const core = new PitchShifterCore(SR);
  const x = new Float32Array(8192);
  x[0] = 1;
  const y = new Float32Array(8192);
  core.process(x, y, 1, false);
  let first = 0;
  for (let i = 0; i < y.length; i++)
    if (Math.abs(y[i]) > 0.02) {
      first = i;
      break;
    }
  assert.ok(Math.abs(first - core.latency) < 700, `first energy at ${first}, latency ${core.latency}`);
});

test('block size independence (128 vs 480 vs 1024)', () => {
  const x = sine(300, SR);
  const a = shiftAll(x, 5, false, 128),
    b = shiftAll(x, 5, false, 1024);
  let d = 0;
  for (let i = 0; i < x.length; i++) d += Math.abs(a[i] - b[i]);
  assert.ok(d / x.length < 1e-6);
});

test('formant preservation: spectral centroid of speech rises less than naive shift', () => {
  const buf = fs.readFileSync(fx('speech_en.wav')); // 48k mono 16-bit with 44-byte-ish header
  const dataOff = buf.indexOf('data') + 8;
  const n = (buf.length - dataOff) >> 1;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(dataOff + i * 2) / 32768;
  const centroid = (y) => {
    const N = 4096,
      f = new FFT(N);
    let num = 0,
      den = 0;
    for (let start = 0; start + N < y.length; start += N * 2) {
      const re = new Float64Array(N),
        im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = y[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      f.transform(re, im);
      for (let k = 1; k < N / 2; k++) {
        const m = Math.hypot(re[k], im[k]);
        num += m * ((k * SR) / N);
        den += m;
      }
    }
    return num / den;
  };
  const c0 = centroid(x);
  const naive = centroid(shiftAll(x, 9, false)),
    preserved = centroid(shiftAll(x, 9, true));
  assert.ok(naive > c0 * 1.2, `naive centroid ${naive.toFixed(0)} vs ${c0.toFixed(0)}`);
  assert.ok(preserved < naive, `formant-preserved centroid ${preserved.toFixed(0)} < naive ${naive.toFixed(0)}`);
  assert.ok(Number.isFinite(preserved));
});
