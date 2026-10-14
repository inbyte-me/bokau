// The studio on a server of accounts: sign in, land in your own studio at /studio/, work on a clip, and nobody else sees it.
// Silent: muted headless Chrome. The identity provider is the dev stand-in.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import type { TestApp } from '@doblaje/testkit';
import { fx, startApp } from '@doblaje/testkit';
import { launch } from '@doblaje/testkit/browser';
import type { Browser } from 'puppeteer-core';

let app: TestApp;
let browser: Browser;
const errors: string[] = [];

test.before(async () => {
  app = await startApp({ mode: 'party', auth: { provider: 'dev' } });
  browser = await launch();
});
test.after(async () => {
  await browser?.close();
  await app?.close();
});

/** a person in a browser of their own */
async function person(name: string) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en'));
  page.on('pageerror', (e: unknown) => errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`));
  return page;
}

test('signed out, /studio/ sends you to sign in; signed in, you land in your own studio and can work on a clip', async () => {
  const pau = await person('pau');
  // the dev stand-in's "login page" bounces straight back with a session: the studio opens
  await pau.goto(`${app.base}/studio/`, { waitUntil: 'domcontentloaded' });
  await pau.waitForSelector('#empty', { timeout: 30_000 });
  assert.match(pau.url(), /\/studio\//);
  assert.deepEqual(await pau.$$eval('.card', (c) => c.length), 0, 'nothing in a new library');

  await pau.click('#new-project');
  await (await pau.$('input#np-file'))?.uploadFile(fx('clip_es.mp4'));
  await pau.$eval('input#np-name', (e) => {
    (e as HTMLInputElement).value = '';
  });
  await pau.type('#np-name', 'Pau’s dub');
  await pau.click('#np-create');
  await pau.waitForSelector('#timeline-canvas', { timeout: 90_000 }); // uploaded, ingested, picture and audio served from his workspace
  assert.equal(await pau.$eval('#proj-title', (e) => (e as HTMLInputElement).value), 'Pau’s dub');
  const folder = `${app.dataDir}/users/dev_devhost/projects`;
  assert.ok(fs.existsSync(folder) && fs.readdirSync(folder).length === 1, 'his files are in a folder of his own');
});

test('another person signs in and sees none of it', async () => {
  const leo = await person('leo');
  // sign in as somebody else: the dev stand-in takes the name from the callback
  await leo.goto(`${app.base}/auth/callback?code=Leo&state=${encodeURIComponent('/studio/')}`, { waitUntil: 'domcontentloaded' });
  await leo.waitForSelector('#empty', { timeout: 30_000 });
  assert.deepEqual(await leo.$$eval('.card', (c) => c.length), 0, 'his library is empty');
  const ids = (await app.api('GET', '/api/projects', undefined, { cookie: 'doblaje-session=Dev%20Host' })).data as { id: string }[];
  assert.equal(ids.length, 1, 'the first person still has their one project');
  assert.equal((await app.api('GET', `/api/projects/${ids[0].id}`, undefined, { cookie: 'doblaje-session=Leo' })).status, 404, 'and Leo cannot open it');
});

test('no page errors', () => {
  assert.deepEqual(errors, []);
});
