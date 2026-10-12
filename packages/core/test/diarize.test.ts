import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTurns,
  cluster,
  clusterAuto,
  dominantSpeaker,
  dot,
  makeSpeakers,
  maskCurve,
  normalize,
  silencedRanges,
  windowsFromSegments,
} from '../src/diarize.ts';

// three "voices" = three directions in 16-d space with noise
const voice = (seed: number, noise = 0.25) => {
  let s = seed * 7919;
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
  return (center: number[]) => Float32Array.from(center, (c: number) => c + r() * noise);
};
const C = [
  Array.from({ length: 16 }, (_, i) => (i < 5 ? 1 : 0)),
  Array.from({ length: 16 }, (_, i) => (i >= 5 && i < 10 ? 1 : 0)),
  Array.from({ length: 16 }, (_, i) => (i >= 10 ? 1 : 0)),
];

test('cluster: recovers the speakers from noisy embeddings, labels in order of first appearance', () => {
  const mk = voice(3);
  const order = [0, 0, 1, 1, 0, 2, 2, 1, 0, 2, 2, 1];
  const labels = cluster(
    order.map((v) => mk(C[v])),
    { threshold: 0.7 },
  );
  assert.deepEqual(labels, [0, 0, 1, 1, 0, 2, 2, 1, 0, 2, 2, 1]);
});
test('cluster: one voice stays one cluster; maxClusters caps over-splitting', () => {
  const mk = voice(5, 0.5);
  const e = Array.from({ length: 8 }, () => mk(C[0]));
  assert.equal(new Set(cluster(e, { threshold: 0.99, maxClusters: 8 })).size > 1, true);
  assert.equal(new Set(cluster(e, { threshold: 0.99, maxClusters: 2 })).size, 2);
  assert.equal(new Set(cluster(e, { threshold: 0.5 })).size, 1);
  assert.deepEqual(cluster([]), []);
});
test('windowsFromSegments splits long speech into ~2.4 s windows and keeps short ones', () => {
  const w = windowsFromSegments([
    { start: 0, end: 7.5 },
    { start: 10, end: 10.4 },
  ]);
  assert.equal(w.length, 4);
  assert.ok(Math.abs(w[0].end - w[0].start - 2.5) < 0.01);
  assert.equal(w.at(-1)!.short, true);
  assert.equal(w[2].end, 7.5);
});
test('buildTurns merges neighbours of one speaker and relabels a tiny interjection between the same speaker', () => {
  const win = [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
    { start: 4, end: 4.3 },
    { start: 4.3, end: 6 },
    { start: 8, end: 10 },
  ];
  const t = buildTurns(win, [0, 0, 1, 0, 1]);
  assert.deepEqual(
    t.map((x) => [x.start, x.end, x.speaker]),
    [
      [0, 6, 0],
      [8, 10, 1],
    ],
  );
});
test('silencedRanges honours mute and solo; maskCurve is 0 inside, 1 outside, with short fades', () => {
  const sp = makeSpeakers(3);
  const seg = [
    { start: 1, end: 2, speaker: 's1' },
    { start: 3, end: 4, speaker: 's2' },
    { start: 5, end: 6, speaker: 's3' },
  ];
  sp[0].muted = true;
  assert.deepEqual(silencedRanges(sp, seg), [{ start: 1, end: 2 }]);
  sp[0].muted = false;
  sp[1].solo = true;
  assert.deepEqual(
    silencedRanges(sp, seg).map((r) => r.start),
    [1, 5],
  );
  const c = maskCurve([{ start: 1, end: 2 }], 0, 4, { rate: 100, fade: 0.02, pad: 0 });
  assert.equal(c[50], 1);
  assert.equal(c[150], 0);
  assert.ok(c[99] >= 0 && c[99] < 1, 'the sample at the range edge is faded or silent');
  assert.ok(c[98] > 0 && c[98] < 1, 'fade before the range');
  assert.equal(c[300], 1);
});
test('dominantSpeaker and normalisation', () => {
  assert.equal(
    dominantSpeaker(
      [
        { start: 0, end: 3, speaker: 'a' },
        { start: 3, end: 10, speaker: 'b' },
      ],
      2.5,
      6,
    ),
    'b',
  );
  assert.equal(dominantSpeaker([], 0, 1), null);
  assert.ok(Math.abs(dot(normalize([3, 4]), normalize([3, 4])) - 1) < 1e-6);
});

test('clusterAuto: one voice stays one cluster, several voices are separated, k forces the count', () => {
  const mk = voice(11, 0.3);
  const common = Float32Array.from({ length: 16 }, () => 0.4); // a shared component, like real x-vectors (different voices ≈ 0.57 raw cosine)
  const add = (v: Float32Array) => Float32Array.from(v, (x: number, i: number) => x + common[i]);
  const one = Array.from({ length: 8 }, () => add(mk(C[0])));
  assert.equal(new Set(clusterAuto(one)).size, 1);
  const order = [0, 1, 2, 0, 1, 2, 0, 1, 2, 1];
  const three = clusterAuto(order.map((v) => add(mk(C[v]))));
  assert.equal(new Set(three).size, 3);
  assert.deepEqual(three, [0, 1, 2, 0, 1, 2, 0, 1, 2, 1]);
  assert.equal(
    new Set(
      clusterAuto(
        order.map((v) => add(mk(C[v]))),
        { k: 2 },
      ),
    ).size,
    2,
  );
  assert.deepEqual(clusterAuto([]), []);
  assert.deepEqual(clusterAuto([add(mk(C[0]))]), [0]);
});

test('split a passage, give one half to another character; touching same-speaker passages merge back', async () => {
  const { splitSegment, assignSegment, segmentAt } = await import('../src/diarize.ts');
  const segs = [
    { start: 0, end: 2, speaker: 's1' },
    { start: 2, end: 5, speaker: 's2' },
    { start: 6, end: 8, speaker: 's1' },
  ];
  assert.equal(splitSegment(segs, 1, 2.05), null, 'too close to the edge');
  const split = splitSegment(segs, 1, 3.5)!;
  assert.deepEqual(
    split.map((g) => [g.start, g.end, g.speaker]),
    [
      [0, 2, 's1'],
      [2, 3.5, 's2'],
      [3.5, 5, 's2'],
      [6, 8, 's1'],
    ],
  );
  // the first half really was Character 1: it merges with the passage before it
  const fixed = assignSegment(split, 1, 's1');
  assert.deepEqual(
    fixed.map((g) => [g.start, g.end, g.speaker]),
    [
      [0, 3.5, 's1'],
      [3.5, 5, 's2'],
      [6, 8, 's1'],
    ],
  );
  assert.equal(segmentAt(fixed, 4), 1);
  assert.equal(segmentAt(fixed, 5.5), -1);
  assert.equal(segmentAt(fixed, 7, 's2'), -1);
  assert.equal(segs.length, 3, 'inputs are not mutated');
});
