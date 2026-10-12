import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import type { TestApp } from '@doblaje/testkit';
import { fx, startApp } from '@doblaje/testkit';
import { injectFakeMic, launch } from '@doblaje/testkit/browser';
import type { Browser, Page } from 'puppeteer-core';

// Clip library: prepare once, derive many projects; at the party, pick a clip and a character and perform it.
// Characters come from the fixture's ground truth, so no voice model is needed. Silent (muted Chrome, fake mic).

let app: TestApp;
let browser: Browser;
let page: Page;
let clipId: string;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  app = await startApp();
  browser = await launch();
  clipId = await app.ingestFixture('clip_voices.mp4', 'pro', { template: true });
  await app.waitJob((await app.api('POST', `/api/projects/${clipId}/stems`, { method: 'auto' })).data.job);
  const truth = JSON.parse(fs.readFileSync(fx('voices.json'), 'utf8')) as { speaker: string; start: number; end: number }[];
  const names = [...new Set(truth.map((x) => x.speaker))];
  const clip = (await app.api('GET', `/api/projects/${clipId}`)).data;
  clip.speakers = {
    list: names.map((n, i) => ({ id: `s${i + 1}`, name: n, color: ['#d97b66', '#6fb3a6', '#7a9cc9'][i], muted: false, solo: false })),
    segments: truth.map((x) => ({ start: x.start, end: x.end, speaker: `s${names.indexOf(x.speaker) + 1}` })),
  };
  clip.cues = truth.map((x, i) => ({ id: `c${i}`, start: x.start, end: x.end, text: `Line ${i + 1}`, character: x.speaker, note: '' }));
  await app.api('PUT', `/api/projects/${clipId}`, clip);
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en'));
  await injectFakeMic(page, fx('mic_speech.wav'));
});
test.after(async () => {
  await browser?.close();
  await app?.close();
});

test('the library lists the clip with its characters; Dub derives a project that starts from the prepared work', async () => {
  await page.goto(`${app.base}/#/`);
  await page.waitForSelector(`tr.clip[data-id="${clipId}"]`);
  const chips = await page.$$eval(`tr.clip[data-id="${clipId}"] .characters .chip`, (els) => els.map((e) => e.textContent));
  assert.deepEqual(chips, ['Samantha', 'Daniel', 'Fred']);
  assert.equal(await page.$('#projects tr.card'), null, 'no projects yet');
  await page.click(`tr.clip[data-id="${clipId}"] .derive-pro`);
  await page.waitForSelector('#timeline-canvas', { timeout: 30000 });
  const p = await page.evaluate(() => ({
    template: window.__app.project.template,
    src: window.__app.project.sourceTemplateId,
    cues: window.__app.project.cues.length,
    lanes: document.querySelectorAll('.tl-head[data-speaker]').length,
  }));
  assert.equal(p.template, false);
  assert.equal(p.src, clipId);
  assert.equal(p.cues, 6);
  assert.equal(p.lanes, 3, 'characters arrive as lanes');
  assert.ok(await page.$('#rec:not(.hidden)'), 'a project records');
  await page.goto(`${app.base}/#/`);
  await page.waitForSelector('#projects tr.card');
  assert.match(await page.$eval('#projects tr.card .from-clip', (e) => e.textContent || ''), /from clip_voices/);
});

test('a clip opens for preparation only: no recording, and "Start a project" offers the three kinds', async () => {
  await page.goto(`${app.base}/#/p/${clipId}`);
  await page.waitForSelector('#use-clip', { timeout: 30000 });
  assert.ok(await page.$('#rec.hidden'), 'no record button');
  assert.equal(await page.$('#tab-record'), null, 'no Record tab');
  assert.ok(await page.$('#clip-badge'));
  await page.click('#use-clip');
  const items = await page.$$eval('.ctxmenu .ctxlabel', (els) => els.map((e) => e.textContent));
  assert.deepEqual(items, ['New dubbing project from this clip', 'New party project from this clip', 'New podcast project from this clip']);
  await page.keyboard.press('Escape');
});

test('party: pick the clip and a character; that voice goes silent, only its lines show; record, reveal, next player', async () => {
  await page.goto(`${app.base}/#/party`);
  await page.waitForSelector(`.pick-clip[data-id="${clipId}"]`);
  await page.keyboard.press('Enter'); // the first clip is focused: sofa-friendly
  await page.waitForSelector('.character-pick');
  await page.type('#player-name', 'Ana');
  await page.click('.character-pick[data-speaker="s2"]'); // Daniel
  await page.click('#pick-start');
  await page.waitForSelector('#perform-start', { timeout: 30000 });
  const state = await page.evaluate(() => ({
    name: window.__app.project.name,
    muted: window.__app.project.speakers.list.filter((s) => s.muted).map((s) => s.name),
    lines: window.__app.project.cues.filter((c) => c.character === 'Daniel').length,
  }));
  assert.equal(state.name, 'clip_voices · Ana');
  assert.deepEqual(state.muted, ['Daniel'], 'only the chosen character is silenced');
  await page.evaluate(() =>
    window.__app.store.commit('fast', (p) => {
      p.settings.preRoll = 0;
    }),
  );
  await page.click('#perform-start');
  await page.waitForFunction(() => window.__app.session.state === 'recording', { timeout: 15000 });
  await wait(1500);
  await page.click('#perform-stop');
  await page.waitForSelector('#next-player', { timeout: 15000 });
  const tracks = await page.evaluate(() => window.__app.project.tracks.map((t) => ({ name: t.name, clips: t.clips.length })));
  assert.ok(
    tracks.some((t) => t.name === 'Ana' && t.clips === 1),
    `the take is on Ana's track: ${JSON.stringify(tracks)}`,
  );
  await page.click('#next-player');
  await page.waitForSelector('#clip-list');
  const clip = (await app.api('GET', `/api/projects/${clipId}`)).data;
  assert.equal(clip.tracks[0].clips.length, 0, 'the library clip stays clean');
  assert.equal(clip.speakers.list.filter((s) => s.muted).length, 0);
});
