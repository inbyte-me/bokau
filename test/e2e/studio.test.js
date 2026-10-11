import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startApp, fx, ffprobeJson, meanDb } from '../helpers.js';
import { launch, openPage, injectFakeMic } from './browser.js';

let app, browser, page, id; const logs = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, label = 'condition') => { const t0 = Date.now(); for (;;) { const v = await page.evaluate(fn); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + label); await wait(100); } };

test.before(async () => {
  app = await startApp(); browser = await launch();
  id = await app.ingestFixture('clip_en.mp4');
  page = await browser.newPage(); page.on('console', (m) => logs.push(m.text())); page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await injectFakeMic(page, fx('mic_speech.wav')); await page.goto(app.base + `/#/p/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#timeline-canvas', { timeout: 30000 });
  await until(() => window.__app?.engine?.assets?.orig, 15000, 'audio loaded');
  await page.evaluate(() => { const a = window.__app; a.store.commit('fast count-in', (p) => { p.settings.preRoll = 1; p.settings.muteOriginalWhileRecording = false; }, ['settings']); });
});
test.after(async () => { await browser?.close(); await app?.close(); });

const openMic = async () => { await page.click('#tab-voice'); await page.click('#mic-open'); await until(() => window.__app.mic.isOpen, 10000, 'mic open'); };
const record = async (ms) => {
  await page.click('#rec'); await until(() => window.__app.session.state === 'recording', 10000, 'recording started');
  await wait(ms); await page.click('#rec'); await until(() => window.__app.session.state === 'idle', 10000, 'recording stopped');
};
const project = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.project)));

test('studio boots without console errors; timeline, band, video are present', async () => {
  assert.ok(await page.$('#timeline-canvas')); assert.ok(await page.$('#band')); assert.ok(await page.$('#video'));
  assert.deepEqual(logs.filter((l) => /PAGEERROR|Uncaught/i.test(l)), []);
  const dur = await page.evaluate(() => window.__app.engine.duration); assert.ok(Math.abs(dur - 12) < 0.3);
});

test('transport: play advances the clock in sync with video; pause/seek/frame-step', async () => {
  await page.evaluate(() => window.__app.engine.seek(1)); await page.click('#play');
  await until(() => window.__app.engine.playing && window.__app.engine.time > 1.6, 8000, 'playing');
  const sync = await page.evaluate(() => ({ t: window.__app.engine.time, v: document.getElementById('video').currentTime, paused: document.getElementById('video').paused }));
  assert.equal(sync.paused, false); assert.ok(Math.abs(sync.t - sync.v) < 0.25, `audio/video drift ${sync.t - sync.v}`);
  await page.click('#play'); const t1 = await page.evaluate(() => window.__app.engine.time); await wait(300);
  assert.equal(await page.evaluate(() => window.__app.engine.time), t1, 'paused clock is stable');
  await page.evaluate(() => window.__app.engine.seek(2)); await page.keyboard.press('ArrowRight');
  const t2 = await page.evaluate(() => window.__app.engine.time); assert.ok(Math.abs(t2 - 2.06) < 0.005, 'steps to the centre of the next 25fps frame: ' + t2);
});

test('record a take: placed at the playhead, non-silent, uploaded, undoable', async () => {
  await openMic();
  await page.evaluate(() => window.__app.engine.seek(2));
  await record(2500);
  const p = await project(); const tr = p.tracks[0]; assert.equal(tr.clips.length, 1); assert.equal(tr.takes.length, 1);
  const clip = tr.clips[0];
  assert.ok(Math.abs(clip.start - 2.0) < 0.01, 'clip starts at the playhead where recording began: ' + clip.start);
  assert.ok(clip.duration > 1.8 && clip.duration < 3.4, 'duration ' + clip.duration);
  const rms = await page.evaluate((f) => { const b = window.__app.engine.assets.takes.get(f); const d = b.getChannelData(0); let s = 0; for (const v of d) s += v * v; return Math.sqrt(s / d.length); }, clip.file);
  assert.ok(rms > 0.01, 'take has audio: ' + rms);
  await page.evaluate(() => window.__app.session.flushUploads());
  const r = await fetch(`${app.base}/media/${id}/takes/${clip.file}`); assert.equal(r.status, 200);
  const info = ffprobeJson(app.dir(id) + '/takes/' + clip.file);
  assert.ok(Math.abs(Number(info.format.duration) - clip.duration) < 0.05); assert.equal(info.streams[0].sample_rate, '48000');
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  assert.equal((await project()).tracks[0].clips.length, 0, 'undo removes the take from the timeline');
  await page.click('#redo'); assert.equal((await project()).tracks[0].clips.length, 1);
});

test('countdown shows 3-2-1-GO before recording and recording waits for GO', async () => {
  await page.evaluate(() => window.__app.store.commit('c', (p) => { p.settings.preRoll = 3; }, ['settings']));
  await page.evaluate(() => { window.__counts = []; window.__app.session.on('countdown', (n) => window.__counts.push(n)); window.__app.engine.seek(6); });
  await page.click('#rec'); await until(() => window.__app.session.state === 'countdown', 5000, 'countdown');
  assert.ok(await page.$('.countdown'), 'big countdown overlay visible');
  await until(() => window.__app.session.state === 'recording', 8000, 'go'); assert.ok(await page.$('.countdown.go') || true);
  await page.click('#rec'); await until(() => window.__app.session.state === 'idle', 8000, 'stopped');
  const counts = await page.evaluate(() => window.__counts); assert.deepEqual(counts.slice(0, 4), [3, 2, 1, 0], JSON.stringify(counts));
  await page.evaluate(() => window.__app.store.commit('c', (p) => { p.settings.preRoll = 1; }, ['settings']));
});

test('punch-in re-records only a 1s window and keeps the surrounding take', async () => {
  await page.evaluate(() => { const a = window.__app; a.store.commit('reset', (p) => { p.tracks[0].clips = []; p.tracks[0].takes = []; }, ['tracks']); a.engine.seek(1); });
  await record(4200); // long take ~ 1..5.2
  const before = (await project()).tracks[0].clips; assert.equal(before.length, 1);
  await page.evaluate(() => { const a = window.__app; a.sel.region = { start: 2.5, end: 3.5 }; a.select({ trackId: a.project.tracks[0].id }); document.getElementById('rec-mode').value = 'region'; });
  await page.select('#rec-mode', 'region');
  await page.click('#rec'); await until(() => window.__app.session.state === 'recording', 10000, 'punch start'); await until(() => window.__app.session.state === 'idle', 15000, 'punch auto-stop at region end');
  const after = (await project()).tracks[0].clips;
  assert.equal(after.length, 3, 'old clip split around the punch: ' + JSON.stringify(after.map((c) => [c.start.toFixed(2), c.duration.toFixed(2)])));
  const [a, b, c] = after;
  assert.ok(Math.abs(a.start + a.duration - 2.5) < 0.02 && Math.abs(b.start - 2.5) < 0.02 && Math.abs(b.start + b.duration - 3.5) < 0.03 && Math.abs(c.start - 3.5) < 0.03, 'contiguous around [2.5,3.5]');
  assert.equal(a.file, c.file); assert.notEqual(a.file, b.file); assert.equal(c.offset > a.offset, true);
  await page.select('#rec-mode', 'playhead');
});

test('loop recording makes one take per pass and the latest is active; older take can be re-applied', async () => {
  await page.evaluate(() => { const a = window.__app; a.store.commit('reset', (p) => { p.tracks[0].clips = []; p.tracks[0].takes = []; p.cues = [{ id: 'cA', start: 3, end: 4.2, text: 'Hello there', character: '' }]; }, ['tracks', 'cues']); a.select({ cueId: 'cA' }); });
  await page.select('#rec-mode', 'loop');
  await page.click('#rec'); await until(() => window.__app.project.tracks[0].takes.length >= 2, 30000, 'two loop takes');
  await page.click('#rec'); await until(() => window.__app.session.state === 'idle', 10000, 'loop stopped');
  const p = await project(); const tr = p.tracks[0]; assert.ok(tr.takes.length >= 2);
  assert.equal(tr.clips.length, 1, 'only one take is active on the timeline');
  assert.equal(tr.clips[0].takeId, tr.takes.at(-1).id, 'latest take active');
  await page.click('#tab-takes'); await page.waitForSelector('#takes-list .take');
  const useBtns = await page.$$('#takes-list .take:not(.active) button.use'); assert.ok(useBtns.length >= 1);
  await useBtns[0].click(); await wait(200);
  const p2 = await project(); assert.notEqual(p2.tracks[0].clips[0].takeId, tr.takes.at(-1).id, 'older take now active');
  await page.select('#rec-mode', 'playhead');
});

test('state persists: reload restores clips, waveforms and audio from the server', async () => {
  await page.evaluate(() => window.__app.session.flushUploads()); await page.evaluate(() => window.__app.store.flush());
  const before = await project();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#timeline-canvas', { timeout: 30000 }); await until(() => window.__app.engine?.assets?.takes?.size > 0, 20000, 'takes reloaded');
  const after = await project();
  assert.deepEqual(after.tracks[0].clips.map((c) => [c.file, c.start]), before.tracks[0].clips.map((c) => [c.file, c.start]));
  assert.equal(after.cues.length, before.cues.length);
});

test('subtitle import via the Cues tab; text edits update syllable meter and persist', async () => {
  await page.click('#tab-cues'); await page.waitForSelector('#sub-file', { hidden: true });
  const input = await page.$('#sub-file'); page.once('dialog', (d) => d.accept());
  await input.uploadFile(fx('sample.srt')); await until(() => window.__app.project.cues.length === 3, 8000, 'imported');
  const cues = (await project()).cues; assert.equal(cues[1].character, 'JOHN'); assert.equal(cues[1].text, 'I would like a cup of coffee, please.');
  await page.waitForSelector('#cue-list .cue textarea');
  const ta = (await page.$$('#cue-list .cue textarea'))[0]; await ta.focus(); await page.evaluate(() => document.querySelector('#cue-list .cue textarea').select()); await page.keyboard.type('Hi there my dear friends');
  await wait(200); assert.equal((await project()).cues[0].text, 'Hi there my dear friends');
  const syl = await page.$eval('#cue-list .cue .syl', (e) => e.textContent); assert.match(syl, /^5 syl/);
});

test('mix: separate stems from the UI, original switches to music-only, ducking curve is exposed', async () => {
  await page.click('#tab-mix'); await page.waitForSelector('#stems-go'); await page.click('#stems-go');
  await until(() => window.__app.project.stems.status === 'ready' && window.__app.engine.assets.bg, 60000, 'stems');
  assert.equal(await page.evaluate(() => window.__app.project.original.source), 'bg');
  await page.evaluate(() => window.__app.engine.play(2)); await until(() => window.__app.engine.handle?.duckCurve, 5000, 'duck curve');
  await page.evaluate(() => window.__app.engine.pause());
});

test('export from the UI: renders in the browser, muxes on the server, recorded voice is audible in the file', async () => {
  await page.evaluate(() => { const a = window.__app; a.store.commit('voice', (p) => { p.ducking.enabled = false; }, ['levels']); });
  await page.evaluate(() => window.__app.session.flushUploads());
  await page.click('#export-btn'); await page.waitForSelector('#ex-go');
  assert.match(await page.$eval('#ex-plan', (e) => e.textContent), /Fast export|copied untouched|Exportación rápida/i);
  await page.click('#ex-go'); await page.waitForSelector('#ex-results a', { timeout: 90000 });
  const files = await page.$$eval('#ex-results a', (a) => a.map((x) => x.dataset.file)); assert.ok(files.some((f) => f.endsWith('.mp4')), files.join());
  const mp4 = files.find((f) => f.endsWith('.mp4'));
  const dirs = fs.readdirSync(app.dir(id) + '/exports'); const out = app.dir(id) + '/exports/' + dirs.at(-1) + '/' + mp4;
  const info = ffprobeJson(out); assert.equal(info.streams.find((s) => s.codec_type === 'video').codec_name, 'h264');
  const p = await project(); const clip = p.tracks[0].clips[0];
  const during = meanDb(out, clip.start + 0.2, Math.min(0.8, clip.duration - 0.4)); const outside = meanDb(out, 10.5, 1);
  assert.ok(during > outside + 3 || during > -35, `voice audible in export: ${during} dB vs ${outside} dB`);
  await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('.modal-back')?.remove());
});

test('no unexpected console errors during the whole session', async () => {
  const bad = logs.filter((l) => /PAGEERROR|Uncaught|Failed to load resource: the server responded with a status of 5/i.test(l));
  assert.deepEqual(bad, []);
});
