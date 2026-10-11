import test from 'node:test';
import assert from 'node:assert/strict';
import { chunksToCues, segmentsToCues } from '../../shared/transcribe.js';

test('chunksToCues splits long chunks on sentences and shares time by syllables', () => {
  const cues = chunksToCues([{ text: ' Hello there. I would like a cup of coffee, please. Do you have any cheese?', timestamp: [1, 13] }], { maxSec: 5 });
  assert.ok(cues.length >= 3, 'split into several cues: ' + JSON.stringify(cues));
  assert.equal(cues[0].start, 1); assert.ok(Math.abs(cues.at(-1).end - 13) < 0.01);
  for (let i = 1; i < cues.length; i++) assert.ok(Math.abs(cues[i].start - cues[i - 1].end) < 0.01, 'contiguous');
  assert.ok(cues.every((c) => c.end - c.start <= 7));
  assert.equal(cues.map((c) => c.text).join(' ').replace(/\s+/g, ' '), 'Hello there. I would like a cup of coffee, please. Do you have any cheese?');
});

test('chunksToCues ignores music/silence tags and handles missing end timestamps', () => {
  const cues = chunksToCues([{ text: ' [Music]', timestamp: [0, 2] }, { text: ' Hola amigo', timestamp: [3, null] }], { duration: 10 });
  assert.equal(cues.length, 1); assert.equal(cues[0].text, 'Hola amigo'); assert.ok(cues[0].end > 3);
});

test('segmentsToCues makes skeleton cues from speech segments', () => {
  const c = segmentsToCues([{ start: 1, end: 3 }, { start: 5, end: 17 }], { maxSec: 6 });
  assert.equal(c.length, 3); assert.equal(c[1].start, 5); assert.equal(c[2].end, 17); assert.ok(c.every((x) => x.text === ''));
});

import { snapCues } from '../../shared/transcribe.js';
test('snapCues pulls a cue start forward to where speech really begins', () => {
  const out = snapCues([{ start: 0, end: 4, text: 'a' }, { start: 4, end: 8, text: 'b' }], [{ start: 1, end: 3.2 }, { start: 5, end: 7.5 }]);
  assert.equal(out[0].start, 1); assert.equal(out[0].end, 3.2); assert.equal(out[1].start, 5); assert.equal(out[1].end, 7.5);
});
test('snapCues leaves cues alone when the audio is one continuous blob', () => {
  const cues = [{ start: 0, end: 4, text: 'a' }];
  assert.deepEqual(snapCues(cues, [{ start: 0, end: 12 }], { duration: 12 }), cues);
  assert.deepEqual(snapCues(cues, []), cues);
});
