import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import type { TestApp } from '@doblaje/testkit';
import { fx, startApp } from '@doblaje/testkit';
import { injectFakeMic, launch } from '@doblaje/testkit/browser';
import type { Browser } from 'puppeteer-core';

let app: TestApp, browser: Browser, up: { url: string; close: () => unknown; reqs: any[] };
const logs = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
test.before(async () => {
  up = await new Promise((resolve) => {
    const reqs = [];
    const srv = http.createServer(async (req, res) => {
      const ch = [];
      for await (const c of req) ch.push(c);
      const body = JSON.parse(Buffer.concat(ch).toString());
      reqs.push(body);
      const items = JSON.parse(body.messages.at(-1).content.split('Lines: ')[1] ?? '[]');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'mock/m',
          choices: [{ message: { content: JSON.stringify({ lines: items.map((i) => ({ id: i.id, text: `ES: ${i.text}`, direction: 'smiling' })) }) } }],
          usage: { cost: 0.0001 },
        }),
      );
    });
    srv.listen(0, '127.0.0.1', () =>
      resolve({
        reqs,
        url: `http://127.0.0.1:${(srv.address() as import('node:net').AddressInfo).port}`,
        close: () => {
          srv.closeAllConnections();
          srv.close();
        },
      }),
    );
  });
  app = await startApp({ ai: { openrouterBase: up.url } });
  browser = await launch();
});
test.after(async () => {
  await browser?.close();
  await app?.close();
  up?.close();
});
const newPage = async (url) => {
  const page = await browser.newPage();
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (err) => logs.push(`PAGEERROR ${(err as Error).message}`));
  await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en'));
  await injectFakeMic(page, fx('mic_speech.wav'));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
};

test('library: empty state, create a project by uploading a video, land in the studio, listed afterwards, delete', async () => {
  const page = await newPage(`${app.base}/`);
  await page.waitForSelector('#empty');
  await page.click('#new-project');
  await page.waitForSelector('#np-file', { hidden: true });
  await (await page.$('input#np-file')).uploadFile(fx('clip_es.mp4'));
  assert.equal(await page.$eval('#np-name', (e) => (e as HTMLInputElement).value), 'clip_es', 'name prefilled from file');
  await page.$eval('input#np-name', (e) => {
    e.value = '';
  });
  await page.type('#np-name', 'Mi doblaje');
  await page.click('#np-create');
  await page.waitForSelector('#timeline-canvas', { timeout: 60000 });
  assert.match(page.url(), /#\/p\/p/);
  assert.equal(await page.$eval('#proj-title', (e) => (e as HTMLInputElement).value), 'Mi doblaje');
  await page.click('.brand');
  await page.waitForSelector('.card');
  assert.equal(await page.$$eval('.card .name', (n) => n.map((x) => x.textContent)).then((a) => a.includes('Mi doblaje')), true);
  await page.hover('.card');
  page.once('dialog', (d) => d.accept());
  await page.click('.card .del');
  await page.waitForSelector('#empty', { timeout: 10000 });
  await page.close();
});

test('library: a party round opens as a round, and in the studio on request', async () => {
  const r = await app.api('POST', '/api/projects/from-path', { path: fx('clip_en.mp4'), mode: 'party' });
  await app.waitJob(r.data.job);
  const id = r.data.project.id;
  const page = await newPage(`${app.base}/#/p/${id}`);
  await page.waitForSelector('#party-round', { timeout: 30000 });
  await page.click('#round-studio');
  await page.waitForSelector('#timeline-canvas', { timeout: 30000 });
  await page.close();
});

test('AI panel: translate all cues with syllable constraint, preview, apply; original text is kept for undo', async () => {
  const r = await app.api('POST', '/api/projects/from-path', { path: fx('clip_es.mp4'), mode: 'pro' });
  await app.waitJob(r.data.job);
  const id = r.data.project.id;
  const { data: p } = await app.api('GET', `/api/projects/${id}`);
  p.cues = [
    { id: 'a', start: 1, end: 2.6, text: 'Hola, buenos días.' },
    { id: 'b', start: 3, end: 5, text: 'Quisiera un café, por favor.' },
  ];
  await app.api('PUT', `/api/projects/${id}`, p);
  const page = await newPage(`${app.base}/#/p/${id}`);
  await page.waitForSelector('#timeline-canvas', { timeout: 30000 });
  await page.click('#tab-ai');
  await page.waitForSelector('#ai-go');
  await wait(300);
  await page.select('#ai-from', 'es');
  await page.select('#ai-to', 'en');
  await page.type('#ai-extra', 'match 7 syllables');
  await page.click('#ai-go');
  await page.waitForSelector('#ai-apply-all', { timeout: 20000 });
  const sent = up.reqs.at(-1);
  assert.equal(sent.model, 'qwen/qwen3.7-flash');
  assert.match(sent.messages.at(-1).content, /Translate each line from Spanish.*into English/s);
  assert.match(sent.messages.at(-1).content, /match 7 syllables/);
  assert.match(sent.messages.at(-1).content, /lipsClosedAtWords/, 'lip-closure (M/B/P) hints are sent');
  await page.click('#ai-apply-all');
  await wait(200);
  const cues = await page.evaluate(() => window.__app.project.cues.map((c) => [c.text, c.orig, c.direction]));
  assert.deepEqual(cues[0], ['ES: Hola, buenos días.', 'Hola, buenos días.', 'smiling']);
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  assert.deepEqual(
    await page.evaluate(() => window.__app.project.cues.map((c) => c.text)),
    ['Hola, buenos días.', 'Quisiera un café, por favor.'],
    'one undo reverts the whole AI rewrite',
  );
  await page.close();
});

test('timeline interactions: add cue by double-click, drag it, resize, delete with undo; shift-drag region; zoom', async () => {
  const r = await app.api('POST', '/api/projects/from-path', { path: fx('clip_en.mp4'), mode: 'pro' });
  await app.waitJob(r.data.job);
  const id = r.data.project.id;
  const page = await newPage(`${app.base}/#/p/${id}`);
  await page.waitForSelector('#timeline-canvas', { timeout: 30000 });
  await wait(800);
  const box = await (await page.$('#timeline-canvas')).boundingBox();
  const pps = await page.evaluate(() => window.__app.view.pps);
  const cueY = box.y + 28 + 42 + 66 + 18; // ruler+thumbs+orig + half cue lane
  await page.mouse.click(box.x + 3 * pps, cueY, { count: 2 });
  await wait(200);
  let cues = await page.evaluate(() => window.__app.project.cues);
  assert.equal(cues.length, 1);
  assert.ok(Math.abs(cues[0].start - 3) < 0.2, `created at click time ${cues[0].start}`);
  const s0 = cues[0].start;
  await page.mouse.move(box.x + (s0 + 0.9) * pps, cueY);
  await page.mouse.down();
  await page.mouse.move(box.x + (s0 + 0.9 + 2) * pps, cueY, { steps: 6 });
  await page.mouse.up();
  await wait(150);
  cues = await page.evaluate(() => window.__app.project.cues);
  assert.ok(Math.abs(cues[0].start - (s0 + 2)) < 0.15, `dragged +2s: ${s0} -> ${cues[0].start}`);
  const e0 = cues[0].end;
  await page.mouse.move(box.x + e0 * pps - 1, cueY);
  await page.mouse.down();
  await page.mouse.move(box.x + (e0 + 1) * pps, cueY, { steps: 5 });
  await page.mouse.up();
  await wait(150);
  cues = await page.evaluate(() => window.__app.project.cues);
  assert.ok(Math.abs(cues[0].end - (e0 + 1)) < 0.2, 'resized');
  await page.keyboard.press('Delete');
  await wait(100);
  assert.equal(await page.evaluate(() => window.__app.project.cues.length), 0);
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  assert.equal(await page.evaluate(() => window.__app.project.cues.length), 1);
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 1 * pps, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + 2.5 * pps, box.y + 14, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const reg = await page.evaluate(() => JSON.parse(JSON.stringify(window.__app.sel.region))); // reactive state is a proxy: copy it out
  assert.ok(reg && Math.abs(reg.end - reg.start - 1.5) < 0.15, `region ${JSON.stringify(reg)}`);
  const z0 = await page.evaluate(() => window.__app.view.pps);
  await page.click('#zoom-in');
  assert.ok(await page.evaluate((z) => window.__app.view.pps > z * 1.3, z0));
  await page.close();
});

test('lip flaps: holding M while playing records a mouth-open marker; Space toggles playback; L loops a cue', async () => {
  const r = await app.api('POST', '/api/projects/from-path', { path: fx('clip_en.mp4'), mode: 'pro' });
  await app.waitJob(r.data.job);
  const id = r.data.project.id;
  const page = await newPage(`${app.base}/#/p/${id}`);
  await page.waitForSelector('#timeline-canvas', { timeout: 30000 });
  await wait(800);
  await page.evaluate(() => window.__app.engine.seek(1));
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__app.engine.playing, { timeout: 5000 });
  await page.keyboard.down('m');
  await wait(700);
  await page.keyboard.up('m');
  await page.keyboard.press('Space');
  await wait(100);
  const flaps = await page.evaluate(() => window.__app.project.lipFlaps);
  assert.equal(flaps.length, 1);
  assert.ok(flaps[0].end - flaps[0].start > 0.5 && flaps[0].end - flaps[0].start < 1.0, JSON.stringify(flaps));
  await page.evaluate(() => {
    const a = window.__app;
    a.store.commit(
      'c',
      (p) => {
        p.cues = [{ id: 'q', start: 4, end: 5, text: 'loop me' }];
      },
      ['cues'],
    );
    a.select({ cueId: 'q' });
  });
  await page.keyboard.press('l');
  assert.deepEqual(await page.evaluate(() => window.__app.project.loop), { start: 4, end: 5 });
  await page.evaluate(() => window.__app.engine.seek(4.2));
  await page.keyboard.press('Space');
  await wait(2600);
  const t = await page.evaluate(() => window.__app.engine.time);
  assert.ok(t >= 3.99 && t <= 5.05, `playback loops inside the cue: ${t}`);
  await page.keyboard.press('Space');
  await page.close();
});

test('no console errors across library/AI/timeline sessions', () =>
  assert.deepEqual(
    logs.filter((l) => /PAGEERROR|Uncaught/.test(l)),
    [],
  ));

test('Spanish UI: the app follows the browser language and translates studio and dialogs', async () => {
  const r = await app.api('POST', '/api/projects/from-path', { path: fx('clip_en.mp4'), mode: 'pro' });
  await app.waitJob(r.data.job);
  const id = r.data.project.id;
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'es'));
  await page.goto(`${app.base}/#/p/${id}`);
  await page.waitForSelector('#timeline-canvas', { timeout: 30000 });
  assert.match(await page.$eval('#tab-voices', (e) => e.textContent), /Voces/);
  assert.match(await page.$eval('#tab-cues', (e) => e.textContent), /Guion/);
  assert.match(await page.$eval('#export-btn', (e) => e.textContent), /Exportar/);
  await page.click('#devices-btn');
  assert.match(await page.$eval('#mic-open', (e) => e.textContent), /Abrir micrófono/);
  await page.click('#devices-done');
  await page.click('#tab-voices');
  await page.waitForSelector('#stems-go');
  assert.match(await page.$eval('#stems-go', (e) => e.textContent), /Separar diálogo/);
  await page.click('#export-btn');
  await page.waitForSelector('#ex-go');
  assert.match(await page.$eval('#ex-plan', (e) => e.textContent), /Exportación rápida/);
  await page.close();
});
