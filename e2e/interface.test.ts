// Budget USB interfaces: 2 inputs with the mic on input 1 only, 44.1 kHz, quiet signal. Simulated here; real hardware: pnpm test:live.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestApp } from '@doblaje/testkit';
import { fx, startApp } from '@doblaje/testkit';
import { injectFakeMic, launch } from '@doblaje/testkit/browser';
import type { Browser } from 'puppeteer-core';

let app: TestApp, browser: Browser, id: string;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
test.before(async () => {
  app = await startApp();
  browser = await launch();
  id = await app.ingestFixture('clip_en.mp4');
});
test.after(async () => {
  await browser?.close();
  await app?.close();
});

async function studioWith(opts) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en'));
  await injectFakeMic(page, fx('mic_speech.wav'), opts);
  await page.goto(`${app.base}/#/p/${id}`);
  await page.waitForSelector('#timeline-canvas', { timeout: 30000 });
  await wait(500);
  await page.click('#devices-btn');
  await page.click('#mic-open');
  await page.waitForFunction(() => window.__app.mic.isOpen, { timeout: 10000 });
  return page;
}
const peakOver = (page, ms = 1800) =>
  page.evaluate(
    (ms) =>
      new Promise((res) => {
        let p = 0;
        const off = window.__app.mic.on('level', (l) => {
          p = Math.max(p, l.peak);
        });
        setTimeout(() => {
          off();
          res(p);
        }, ms);
      }),
    ms,
  );

test('2-input interface with the mic on input 1 only: Auto detects the live input and does not lose 6 dB to the dead one', async () => {
  const page = await studioWith({ channels: 2, only: 0, rate: 44100 });
  assert.equal(await page.evaluate(() => window.__app.mic.channels), 2);
  await wait(3500); // let the auto-detector listen
  assert.equal(await page.evaluate(() => window.__app.mic.autoChannel), 'left', 'auto picked input 1');
  const auto = await peakOver(page);
  await page.select('#mic-channel', 'mix');
  await wait(300);
  const mixed = await peakOver(page);
  await page.select('#mic-channel', 'left');
  await wait(300);
  const left = await peakOver(page);
  await page.select('#mic-channel', 'right');
  await wait(300);
  const right = await peakOver(page);
  assert.ok(left > 0.05, `input 1 has the voice: ${left}`);
  assert.ok(right < 0.001, `input 2 is silent: ${right}`);
  assert.ok(auto > mixed * 1.6, `auto (${auto.toFixed(3)}) is ~6 dB hotter than blindly mixing (${mixed.toFixed(3)})`);
  await page.close();
});

test('mic on input 2 only is detected too, and both-inputs-live stays a mix', async () => {
  let page = await studioWith({ channels: 2, only: 1 });
  await wait(3500);
  assert.equal(await page.evaluate(() => window.__app.mic.autoChannel), 'right');
  await page.close();
  page = await studioWith({ channels: 2 });
  await wait(3500);
  assert.equal(await page.evaluate(() => window.__app.mic.autoChannel), 'mix');
  await page.close();
});

test('interface-style take: record through input 1 at 44.1 kHz, take is full-level and correctly placed', async () => {
  const page = await studioWith({ channels: 2, only: 0, rate: 44100 });
  await wait(3500);
  await page.click('#devices-done'); // back to the studio, mic stays open
  await page.evaluate(() => {
    const a = window.__app;
    a.store.commit(
      'x',
      (p) => {
        p.settings.preRoll = 1;
      },
      ['settings'],
    );
    a.engine.seek(2);
  });
  await page.click('#rec');
  await page.waitForFunction(() => window.__app.session.state === 'recording', { timeout: 10000 });
  await wait(2200);
  await page.click('#rec');
  await page.waitForFunction(() => window.__app.session.state === 'idle', { timeout: 10000 });
  const r = await page.evaluate(() => {
    const c = window.__app.project.tracks[0].clips[0];
    const d = window.__app.engine.assets.takes.get(c.file).getChannelData(0);
    let pk = 0;
    for (const v of d) pk = Math.max(pk, Math.abs(v));
    return { start: c.start, dur: c.duration, pk, sr: window.__app.engine.assets.takes.get(c.file).sampleRate };
  });
  assert.ok(Math.abs(r.start - 2) < 0.01 && r.dur > 1.8, JSON.stringify(r));
  assert.ok(r.pk > 0.05, `take is not attenuated: ${r.pk}`);
  assert.equal(r.sr, 48000, 'resampled to the project rate');
  await page.close();
});

test('quiet budget mic: Mic check flags it and the suggested trim brings the take up to a healthy level', async () => {
  const page = await studioWith({ channels: 1 });
  await page.evaluate(() => {
    window.__app.mic.setGainDb(-30);
  }); // emulate a very quiet mic
  const chk = await page.evaluate(() => window.__app.mic.check({ silenceSec: 0.6, speakSec: 2.5 }));
  assert.ok(
    chk.advice.some((a) => ['too-quiet', 'quiet'].includes(a)),
    JSON.stringify(chk.advice),
  );
  assert.ok(chk.suggestedGainDb > 15, `suggested trim ${chk.suggestedGainDb}`);
  await page.evaluate((g) => window.__app.mic.setGainDb(window.__app.mic.settings.gainDb + g), chk.suggestedGainDb);
  await wait(300);
  const after = await peakOver(page, 1500);
  assert.ok(after > 0.3 && after <= 1, `after applying the suggestion the peak is healthy: ${after}`);
  await page.close();
});
