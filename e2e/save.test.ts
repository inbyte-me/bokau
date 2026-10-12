import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestApp } from '@doblaje/testkit';
import { startApp } from '@doblaje/testkit';
import { launch } from '@doblaje/testkit/browser';
import type { Browser, HTTPRequest, Page } from 'puppeteer-core';

// Saving you can see and control: status in the top bar, save button, File → Save, ⌘/Ctrl+S, and a failure that
// is reported (not silent). Silent test.

let app: TestApp;
let browser: Browser;
let page: Page;
let id: string;
let puts = 0;
let failNext = false;

test.before(async () => {
  app = await startApp();
  browser = await launch();
  id = await app.ingestFixture('clip_en.mp4');
  page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (r: HTTPRequest) => {
    const isSave = r.method() === 'PUT' && r.url().endsWith(`/api/projects/${id}`);
    if (isSave) puts++;
    if (isSave && failNext) {
      failNext = false;
      void r.respond({ status: 500, contentType: 'application/json', body: '{"error":"disk full"}' });
    } else void r.continue();
  });
  await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en'));
  await page.goto(`${app.base}/#/p/${id}`);
  await page.waitForSelector('#save-state', { timeout: 30000 });
});
test.after(async () => {
  await browser?.close();
  await app?.close();
});

const state = () => page.$eval('#save-state', (e) => ({ text: e.textContent, state: (e as HTMLElement).dataset.state }));
const edit = () =>
  page.evaluate(() =>
    window.__app.store.commit('rename', (p) => {
      p.name = `${p.name}!`;
    }),
  );
const until = async (fn: () => Promise<boolean>, ms = 5000) => {
  const t0 = Date.now();
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('the status says Saved, then Unsaved changes after an edit, then Saved with the time once autosave runs', async () => {
  assert.equal((await state()).state, 'saved');
  assert.match((await state()).text || '', /^Saved/);
  await edit();
  assert.equal((await state()).text, 'Unsaved changes');
  await until(async () => (await state()).state === 'saved', 4000);
  assert.match((await state()).text || '', /^Saved \d{1,2}:\d{2}/, 'shows when it was saved');
});

test('the save button, File → Save and ⌘/Ctrl+S all save immediately', async () => {
  const before = puts;
  await page.click('#save-btn');
  await until(async () => puts === before + 1);
  await page.click('#file-menu');
  await page.waitForSelector('.ctxmenu');
  const labels = await page.$$eval('.ctxmenu .ctxitem .ctxlabel', (els) => els.map((e) => e.textContent));
  assert.deepEqual(labels, ['New project…', 'Open…', 'Save', 'Export…', 'Close project']);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.ctxmenu .ctxitem')].find((b) => b.textContent?.includes('Save'))?.click());
  await until(async () => puts === before + 2);
  // the shortcut works even while typing in a text field
  await page.click('#proj-title');
  await page.keyboard.down('Meta');
  await page.keyboard.press('s');
  await page.keyboard.up('Meta');
  await until(async () => puts === before + 3);
  await page.keyboard.down('Control');
  await page.keyboard.press('s');
  await page.keyboard.up('Control');
  await until(async () => puts === before + 4);
  assert.equal((await state()).state, 'saved');
  assert.equal(await page.evaluate(() => window.__app.project.cues.length), 0, 'S (split) did not fire for ⌘S');
});

test('a failed save is shown, keeps the changes, and the next save recovers', async () => {
  failNext = true;
  await edit();
  await page.click('#save-btn');
  await until(async () => (await state()).state === 'error');
  assert.equal((await state()).text, 'Save failed');
  assert.ok(await page.$('#save-btn.attention'), 'the button asks for attention');
  assert.ok(await page.$('.toast.error'), 'and a message explains it');
  await page.click('#save-btn');
  await until(async () => (await state()).state === 'saved');
  const saved = (await app.api('GET', `/api/projects/${id}`)).data;
  assert.ok(saved.name.endsWith('!!'), 'both edits reached the server');
});
