// Real-hardware output test: send the app's sound to a chosen output (TV, headphones, interface) and measure the round trip with the mic.
//   LIVE_MIC=1 LIVE_OUTPUT="TV" [LIVE_DEVICE="USB Audio CODEC"] node --test e2e/live-output.test.ts
// Needs a real (headed) Chrome window, because headless Chrome does not drive the speakers.

import assert from 'node:assert/strict';
import test from 'node:test';
import { startApp } from '@doblaje/testkit';
import { launch } from '@doblaje/testkit/browser';

const LIVE = process.env.LIVE_MIC === '1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pickOption = (page, sel, re) =>
  page.evaluate(
    (sel, re) => {
      const s = document.querySelector(sel);
      const o = [...s.options].find((x) => new RegExp(re, 'i').test(x.textContent));
      if (!o) return null;
      s.value = o.value;
      s.dispatchEvent(new Event('change'));
      return o.textContent;
    },
    sel,
    re,
  );

test('REAL OUTPUT: route sound to the chosen output and measure round-trip latency with the mic', {
  skip: !LIVE && 'set LIVE_MIC=1 to run against real hardware',
  timeout: 240000,
}, async () => {
  const app = await startApp();
  const browser = await launch({ realMic: true, audible: true, headless: false });
  try {
    const id = await app.ingestFixture('clip_en.mp4');
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en'));
    await page.goto(`${app.base}/#/p/${id}`);
    await page.waitForSelector('#timeline-canvas');
    await wait(800);
    await page.click('#devices-btn');
    await page.click('#mic-open');
    await page.waitForFunction(() => window.__app.mic.isOpen, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#mic-device option').length > 0 && document.querySelectorAll('#out-device option').length > 0, {
      timeout: 10000,
    });
    if (process.env.LIVE_DEVICE) {
      const d = await pickOption(page, '#mic-device', process.env.LIVE_DEVICE);
      assert.ok(d, `input device not found: ${process.env.LIVE_DEVICE}`);
      console.log('   input:', d);
      await wait(1500);
    }
    if (process.env.LIVE_OUTPUT) {
      const o = await pickOption(page, '#out-device', process.env.LIVE_OUTPUT);
      assert.ok(
        o,
        `output not found: ${process.env.LIVE_OUTPUT} — saw: ${await page.$$eval('#out-device option', (x) => x.map((y) => y.textContent).join(' | '))}`,
      );
      console.log('   output:', o);
      await wait(1200);
    }
    const sink = await page.evaluate(() => window.__app.engine.ctx.sinkId);
    console.log('   sink id:', String(sink).slice(0, 12) || '(default)');
    const r = await page.evaluate(async () => {
      const { calibrateLatency } = await window.__testing.audio();
      const r = await calibrateLatency(window.__app.engine, window.__app.mic);
      return { ms: r.ms, ok: r.ok, agreeing: r.agreeing, delays: r.delays.map((d) => +d.toFixed(1)) };
    });
    console.log('   round trip:', r.ms && `${r.ms.toFixed(1)} ms`, '| agreeing clicks:', `${r.agreeing}/${r.delays.length}`, '| all:', r.delays.join(', '));
    assert.ok(r.ok, 'the microphone must hear the clicks from this output (volume up, mic within hearing range)');
    assert.ok(r.ms > 5 && r.ms < 900, `plausible latency ${r.ms}`);
  } finally {
    await browser.close();
    await app.close();
  }
});
