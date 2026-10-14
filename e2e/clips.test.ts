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

test('a clip opens for preparation only: no recording, and "Start a project" offers dubbing, a party and a podcast', async () => {
  await page.goto(`${app.base}/#/p/${clipId}`);
  await page.waitForSelector('#use-clip', { timeout: 30000 });
  assert.ok(await page.$('#rec.hidden'), 'no record button');
  assert.equal(await page.$('#tab-record'), null, 'no Record tab');
  assert.ok(await page.$('#clip-badge'));
  await page.click('#use-clip');
  const items = await page.$$eval('.ctxmenu .ctxlabel', (els) => els.map((e) => e.textContent));
  assert.deepEqual(items, ['New dubbing project from this clip', 'Play at a party', 'New podcast project from this clip']);
  await page.keyboard.press('Escape');
});

test('remove a character from a clip: a warning first, then its lane goes and the original is silent where it spoke', async () => {
  await page.goto(`${app.base}/#/p/${clipId}`);
  await page.waitForSelector('.tl-head[data-speaker="s3"]', { timeout: 30000 });
  const project = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.project)));
  const fred = (await project()).speakers.segments.filter((g: { speaker: string }) => g.speaker === 's3');
  assert.ok(fred.length > 0);
  const remove = async (answer: boolean) => {
    let warning = '';
    page.once('dialog', (d) => {
      warning = d.message();
      void (answer ? d.accept() : d.dismiss());
    });
    await page.click('.tl-head[data-speaker="s3"]', { button: 'right' });
    await page.evaluate(() => {
      [...document.querySelectorAll<HTMLButtonElement>('.ctxmenu .ctxitem')].find((b) => b.textContent?.includes('Remove Fred'))?.click();
    });
    await page.waitForFunction(() => !document.querySelector('.ctxmenu'));
    return warning;
  };
  // saying no changes nothing
  assert.match(
    await remove(false),
    new RegExp(`Remove Fred\\? Their ${fred.length} passages are removed from the timeline and the original dialogue goes silent`),
  );
  assert.equal((await project()).speakers.list.length, 3);
  // saying yes removes the character and leaves silence in its place
  await remove(true);
  await page.waitForFunction(() => !document.querySelector('.tl-head[data-speaker="s3"]'));
  const p = await project();
  assert.deepEqual(
    p.speakers.list.map((s: { name: string }) => s.name),
    ['Samantha', 'Daniel'],
  );
  assert.ok(!p.speakers.segments.some((g: { speaker: string }) => g.speaker === 's3'), 'its passages are gone');
  assert.deepEqual(
    p.dubbed,
    fred.map((g: { start: number; end: number }) => ({ start: g.start, end: g.end })),
    'silence where it spoke',
  );
  assert.ok(!p.cues.some((c: { character: string }) => c.character === 'Fred'), 'lines lose its name');
  // undo brings it back
  await page.evaluate(() => window.__app.store.undo());
  assert.equal((await project()).speakers.list.length, 3);
  assert.deepEqual((await project()).dubbed, []);
});
