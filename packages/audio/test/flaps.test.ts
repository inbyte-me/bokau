import assert from 'node:assert/strict';
import test from 'node:test';
import { detectFlaps } from '../src/flaps.ts';

const env = (spec, rate = 100, n = 800) => {
  const e = new Float32Array(n).fill(0.001);
  for (const [a, b, v] of spec) for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) e[i] = v;
  return e;
};
test('flaps: finds speech bursts, bridges tiny gaps, drops blips', () => {
  const e = env([
    [1, 2, 0.2],
    [2.04, 3, 0.18],
    [5, 5.04, 0.2],
    [6, 7, 0.01],
    [7.2, 7.8, 0.2],
  ]);
  const f = detectFlaps(e);
  assert.equal(f.length, 2, JSON.stringify(f));
  assert.ok(Math.abs(f[0].start - 1) < 0.03 && Math.abs(f[0].end - 3) < 0.03, 'bridged 40ms gap');
  assert.ok(Math.abs(f[1].start - 7.2) < 0.03);
});
test('flaps: silence yields nothing', () => assert.deepEqual(detectFlaps(env([])), []));
