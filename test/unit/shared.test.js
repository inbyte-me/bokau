import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubs, toSrt, toVtt, toJson, fmtTime, parseTime } from '../../shared/srt.js';
import { countSyllables, countText, wordTimings, bilabialIdx, detectLang } from '../../shared/syllables.js';
import { carveClips, defaultProject, migrate, projectDuration } from '../../shared/project.js';

test('srt: time formatting round trip', () => {
  assert.equal(fmtTime(3661.5), '01:01:01,500');
  assert.equal(fmtTime(1.2345, '.'), '00:00:01.235');
  assert.equal(parseTime('00:01:02,250'), 62.25);
  assert.equal(parseTime('01:02.5'), 62.5);
});

test('srt: parses SRT with tags, characters and CRLF', () => {
  const t = '1\r\n00:00:01,000 --> 00:00:02,500\r\nHello there.\r\n\r\n2\r\n00:00:03,000 --> 00:00:06,000\r\nJOHN: I would like <i>coffee</i>.\r\nSecond line\r\n';
  const c = parseSubs(t);
  assert.equal(c.length, 2);
  assert.equal(c[0].text, 'Hello there.');
  assert.equal(c[1].character, 'JOHN');
  assert.equal(c[1].text, 'I would like coffee. Second line');
  assert.equal(c[1].end, 6);
});

test('vtt: parses and ignores header/notes', () => {
  const c = parseSubs('WEBVTT\n\nNOTE hi\n\n00:01.000 --> 00:02.500 align:start\nHola\n');
  assert.deepEqual(c.map((x) => [x.start, x.end, x.text]), [[1, 2.5, 'Hola']]);
});

test('srt/vtt/json export', () => {
  const cues = [{ start: 1, end: 2, text: 'Hi', character: 'Ann' }];
  assert.match(toSrt(cues), /^1\n00:00:01,000 --> 00:00:02,000\nANN: Hi\n/);
  assert.match(toVtt(cues), /<v Ann>Hi/);
  const j = JSON.parse(toJson(cues, { project: 'x' }));
  assert.equal(j.cues[0].character, 'Ann'); assert.equal(j.project, 'x');
});

test('syllables en/es/fr', () => {
  const en = { hello: 2, coffee: 2, cheese: 1, refrigerator: 5, the: 1, table: 2, wanted: 2, beautiful: 3 };
  for (const [w, n] of Object.entries(en)) assert.equal(countSyllables(w, 'en'), n, w);
  const es = { queso: 2, café: 2, buenos: 2, días: 2, increíble: 4, hola: 2, país: 2, agua: 2 };
  for (const [w, n] of Object.entries(es)) assert.equal(countSyllables(w, 'es'), n, w);
  assert.equal(countText('Quisiera un café por favor', 'es'), 9);
  assert.equal(countSyllables('bonjour', 'fr'), 2);
});

test('language detection', () => {
  assert.equal(detectLang('Hola, ¿tienen queso para mi?'), 'es');
  assert.equal(detectLang('I would like the coffee and cheese'), 'en');
  assert.equal(detectLang('Je ne veux pas le fromage, mais vous'), 'fr');
});

test('wordTimings fills the cue exactly, heavier words get longer', () => {
  const w = wordTimings({ start: 10, end: 14, text: 'I need refrigerator, now' }, 'en');
  assert.equal(w.length, 4);
  assert.ok(Math.abs(w[0].start - 10) < 1e-9 && Math.abs(w[3].end - 14) < 1e-9);
  assert.ok(w[2].end - w[2].start > w[0].end - w[0].start);
  for (let i = 1; i < w.length; i++) assert.ok(Math.abs(w[i].start - w[i - 1].end) < 1e-9);
});

test('bilabials: m b p (v in es)', () => {
  assert.deepEqual(bilabialIdx('mamba', 'en'), [0, 2, 3]);
  assert.deepEqual(bilabialIdx('vaca', 'es'), [0]);
  assert.deepEqual(bilabialIdx('vaca', 'en'), []);
});

test('carveClips: punch-in splits without losing source offsets', () => {
  const clips = [{ id: 'a', file: 'f.wav', start: 0, offset: 0, duration: 10 }];
  const out = carveClips(clips, 4, 6);
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].start, out[0].offset, out[0].duration], [0, 0, 4]);
  assert.deepEqual([out[1].start, out[1].offset, out[1].duration], [6, 6, 4]);
  assert.equal(carveClips(clips, 0, 10).length, 0);
  assert.equal(carveClips(clips, 20, 30).length, 1);
  const head = carveClips(clips, -1, 3); assert.deepEqual([head[0].start, head[0].offset, head[0].duration], [3, 3, 7]);
});

test('migrate fills defaults and keeps data', () => {
  const m = migrate({ id: 'p1', name: 'x', mode: 'party', ducking: { db: -9 }, tracks: [{ name: 'A' }] });
  assert.equal(m.ducking.db, -9); assert.equal(m.ducking.enabled, true);
  assert.equal(m.tracks[0].fx, 'none'); assert.ok(m.tracks[0].id);
  assert.equal(projectDuration({ media: { duration: 5 }, tracks: [{ clips: [{ start: 4, duration: 3 }] }] }), 7);
  assert.equal(defaultProject({ id: 'q' }).original.ghost.enabled, false);
});
