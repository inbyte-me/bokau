import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { startApp, fx, ffprobeJson } from '../helpers.js';
import { launch, injectFakeMic } from './browser.js';

let app, browser, page; const logs = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
test.before(async () => {
  app = await startApp(); browser = await launch();
  page = await browser.newPage(); page.on('console', (m) => logs.push(m.text())); page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en')); await injectFakeMic(page, fx('mic_speech.wav'), { channels: 1 });
});
test.after(async () => { await browser?.close(); await app?.close(); });
const proj = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.project)));

test('create a podcast project from the library without any file', async () => {
  await page.goto(app.base + '/'); await page.waitForSelector('#empty'); await page.click('#new-project'); await page.waitForSelector('.mode[data-mode="podcast"]');
  assert.equal(await page.$$eval('.mode', (m) => m.length), 3, 'Pro, Party and Podcast');
  await page.click('.mode[data-mode="podcast"]'); await page.click('#np-create'); await page.waitForSelector('#pod-rec', { timeout: 20000 });
  assert.equal((await proj()).mode, 'podcast');
});

test('camera preview shows live video and the mic meter moves', async () => {
  await page.waitForFunction(() => { const v = document.getElementById('cam-preview'); return v && v.videoWidth > 0; }, { timeout: 15000 });
  await page.waitForFunction(() => window.__app.mic.isOpen, { timeout: 15000 });
  const peak = await page.evaluate(() => new Promise((res) => { let p = 0; const off = window.__app.mic.on('level', (l) => { p = Math.max(p, l.peak); }); setTimeout(() => { off(); res(p); }, 1500); }));
  assert.ok(peak > 0.02, 'meter sees the voice: ' + peak);
  assert.equal(await page.$eval('#pod-rec', (b) => b.disabled), false);
});

test('record video + audio with a chapter, stream it to disk, land in the review screen', async () => {
  await page.click('#pod-rec'); await page.waitForFunction(() => document.getElementById('pod-rec').classList.contains('on'), { timeout: 10000 });
  await wait(1800); await page.keyboard.press('m'); await wait(2200);
  const mid = await page.$eval('#pod-chapters input', (e) => e.value).catch(() => null); assert.ok(mid, 'a chapter appears while recording');
  assert.ok(Number((await page.$eval('#rec-size', (e) => e.textContent)).replace(/[^\d.]/g, '')) > 0, 'bytes are being saved');
  await page.click('#pod-rec'); await page.waitForSelector('#wave', { timeout: 60000 });
  const p = await proj(); assert.equal(p.media.ready, true); assert.equal(p.media.hasVideo, true); assert.equal(p.media.hasAudio, true);
  assert.ok(p.media.duration > 3.2 && p.media.duration < 5.5, 'duration ' + p.media.duration);
  assert.equal(p.podcast.chapters.length, 1); assert.ok(p.podcast.chapters[0].t > 1.2 && p.podcast.chapters[0].t < 2.6, 'chapter time ' + p.podcast.chapters[0].t);
  assert.ok(fs.existsSync(app.dir(p.id) + '/source.webm'));
});

test('review: play, trim with the buttons, edit chapters', async () => {
  await page.click('#pod-play'); await page.waitForFunction(() => window.__app.engine.playing && window.__app.engine.time > 0.4, { timeout: 8000 }); await page.click('#pod-play');
  await page.evaluate(() => window.__app.engine.seek(0.8)); await page.click('#trim-in'); await page.evaluate(() => window.__app.engine.seek(3.0)); await page.click('#trim-out');
  const tr = (await proj()).podcast.trim; assert.ok(tr && Math.abs(tr.start - 0.8) < 0.05 && Math.abs(tr.end - 3.0) < 0.05, JSON.stringify(tr));
  assert.match(await page.$eval('#trim-info', (e) => e.textContent), /00:00\.800 → 00:03\.000/);
  await page.click('#pod-add-chapter'); assert.equal((await proj()).podcast.chapters.length, 2);
  await page.$eval('#pod-chapters input', (e) => { e.value = 'Welcome'; e.dispatchEvent(new Event('change')); });
  assert.equal((await proj()).podcast.chapters[0].title, 'Welcome');
});

test('export M4A: trimmed, voice cleaned, loudness normalised, chapters embedded, result reported', async () => {
  await page.select('#pod-format', 'm4a'); await page.click('#pod-export'); await page.waitForSelector('#pod-results a', { timeout: 90000 });
  const files = await page.$$eval('#pod-results a', (a) => a.map((x) => x.dataset.file)); assert.ok(files.some((f) => f.endsWith('.m4a')), files.join());
  const msg = await page.$eval('#pod-msg', (e) => e.textContent); assert.match(msg, /LUFS/, msg);
  const p = await proj(); const dir = fs.readdirSync(app.dir(p.id) + '/exports').at(-1); const f = `${app.dir(p.id)}/exports/${dir}/${files.find((x) => x.endsWith('.m4a'))}`;
  const info = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_chapters', f], { encoding: 'utf8' }).stdout);
  assert.ok(Math.abs(Number(info.format.duration) - 2.2) < 0.35, 'trim applied: ' + info.format.duration);
  assert.ok(info.chapters.length >= 1 && info.chapters[0].tags.title, 'chapters embedded');
  const lufs = Number(/(-?[\d.]+) LUFS/.exec(msg)[1]); assert.ok(Math.abs(lufs + 16) < 1.5, 'measured ' + lufs);
});

test('audio-only recording: camera off, record, review, export MP3', async () => {
  await page.click('#pod-new'); await page.waitForSelector('#pod-rec', { timeout: 20000 });
  await page.waitForFunction(() => window.__app.mic.isOpen, { timeout: 15000 });
  await page.click('#use-video'); await wait(300); assert.equal(await page.$eval('#use-video', (e) => e.checked), false);
  await page.click('#pod-rec'); await page.waitForFunction(() => document.getElementById('pod-rec').classList.contains('on'), { timeout: 10000 }); await wait(2500); await page.click('#pod-rec');
  await page.waitForSelector('#wave', { timeout: 60000 }); const p = await proj(); assert.equal(p.media.hasVideo, false); assert.equal(p.media.hasAudio, true); assert.ok(p.media.duration > 1.8);
  assert.equal(await page.$$eval('#pod-format option', (o) => o.map((x) => x.value).join()), 'mp3,m4a,wav', 'video formats hidden for audio-only');
  await page.select('#pod-format', 'mp3'); await page.click('#pod-export'); await page.waitForSelector('#pod-results a', { timeout: 60000 });
  const f = await page.$eval('#pod-results a', (a) => a.dataset.file); assert.match(f, /\.mp3$/);
});

test('transcribe from the review screen creates cues', async () => {
  await page.select('#pod-lang', 'english'); await page.click('#pod-transcribe'); await page.waitForFunction(() => window.__app.project.cues.length > 0, { timeout: 120000 });
  assert.ok((await proj()).cues[0].text.length > 3);
});

test('no page errors across the podcast session', () => assert.deepEqual(logs.filter((l) => /PAGEERROR|Uncaught/.test(l)), []));
