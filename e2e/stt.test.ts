import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestApp } from '@doblaje/testkit';
import { startApp } from '@doblaje/testkit';
import { launch, openPage } from '@doblaje/testkit/browser';
import type { Browser, Page } from 'puppeteer-core';

let app: TestApp, browser: Browser, page: Page;
test.before(async () => {
  app = await startApp();
  browser = await launch();
  page = await openPage(browser, `${app.base}/`);
});
test.after(async () => {
  await browser?.close();
  await app?.close();
});

test('speech-to-text in a worker: English clip -> timestamped cues (local ONNX, model cached by the server)', async () => {
  const id = await app.ingestFixture('clip_en.mp4');
  await app.waitJob((await app.api('POST', `/api/projects/${id}/stems`)).data.job); // transcribe the cleaner dialogue stem
  const res = await page.evaluate(async (id) => {
    const { transcribeProject } = await window.__testing.speech();
    const progress = [];
    const project = { id, media: { duration: 12 }, stems: { status: 'ready' } };
    const r = await transcribeProject(project, {
      model: 'Xenova/whisper-tiny',
      language: 'en',
      onProgress: (p) => {
        if (p.type === 'progress') progress.push(Math.round(p.pct * 100));
      },
    });
    return { text: r.text, cues: r.cues, progress: progress.slice(-1) };
  }, id);
  console.log('   transcript:', res.text);
  assert.match(res.text.toLowerCase(), /coffee/);
  assert.match(res.text.toLowerCase(), /cheese/);
  assert.ok(res.cues.length >= 2);
  assert.ok(res.cues[0].start >= 0.5 && res.cues[0].start < 3, `speech starts ~1s: ${res.cues[0].start}`);
  assert.ok(res.cues.at(-1).end <= 12.01);
});

test('Spanish clip is transcribed with the language hint', async () => {
  const id = await app.ingestFixture('clip_es.mp4');
  const res = await page.evaluate(async (id) => {
    const { transcribeProject } = await window.__testing.speech();
    return transcribeProject({ id, media: { duration: 12 }, stems: { status: 'none' } }, { model: 'Xenova/whisper-tiny', language: 'spanish' });
  }, id);
  console.log('   transcript:', res.text);
  assert.match(res.text.toLowerCase(), /caf[eé]|queso/);
});
