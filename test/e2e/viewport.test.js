// The whole frame must always be visible: the video fits its stage, and the stage fits the window, for any video size / window size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, fx } from '../helpers.js';
import { launch, injectFakeMic } from './browser.js';

let app, browser; const ids = {};
const SIZES = [[1500, 940], [1024, 700], [1920, 1080], [900, 1000], [1280, 600]];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
test.before(async () => {
  app = await startApp(); browser = await launch();
  for (const [k, f, mode] of [['land', 'clip_1080.mp4', 'pro'], ['tall', 'clip_tall.mp4', 'pro'], ['party', 'clip_1080.mp4', 'party'], ['pod', 'clip_1080.mp4', 'podcast']]) {
    const r = await app.api('POST', '/api/projects/from-path', { path: fx(f), mode }); await app.waitJob(r.data.job); ids[k] = r.data.project.id;
  }
});
test.after(async () => { await browser?.close(); await app?.close(); });

async function check(page, label) {
  const m = await page.evaluate(() => {
    const v = document.querySelector('.stage video, video#video'); const st = v?.closest('.stage'); if (!v || !st) return null;
    const vr = v.getBoundingClientRect(), sr = st.getBoundingClientRect(), cs = getComputedStyle(v);
    return { v: [vr.left, vr.top, vr.right, vr.bottom], s: [sr.left, sr.top, sr.right, sr.bottom], fit: cs.objectFit, vw: v.videoWidth, vh: v.videoHeight, win: [innerWidth, innerHeight], docOverflowX: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert.ok(m, label + ': video + stage present');
  const [vl, vt, vr, vb] = m.v, [sl, stp, sr, sb] = m.s;
  assert.ok(vl >= sl - 1 && vt >= stp - 1 && vr <= sr + 1 && vb <= sb + 1, `${label}: video box ${m.v.map(Math.round)} must lie inside its stage ${m.s.map(Math.round)}`);
  assert.equal(m.fit, 'contain', label + ': object-fit contain shows the whole frame');
  assert.ok(sr <= m.win[0] + 1 && sb <= m.win[1] + 1 && sl >= -1 && stp >= -1, `${label}: stage ${m.s.map(Math.round)} must be inside the window ${m.win}`);
  assert.ok(sr - sl >= 150 && sb - stp >= 90, `${label}: stage is not collapsed (${Math.round(sr - sl)}×${Math.round(sb - stp)})`);
  assert.equal(m.docOverflowX, false, label + ': no horizontal page scroll');
}

for (const [w, h] of SIZES) {
  test(`1080p and portrait videos fit the studio stage at ${w}×${h}`, async () => {
    const page = await browser.newPage(); await page.setViewport({ width: w, height: h }); await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en'));
    for (const k of ['land', 'tall']) { await page.goto(app.base + `/#/p/${ids[k]}`); await page.waitForSelector('#timeline-canvas', { timeout: 30000 }); await page.waitForFunction(() => document.getElementById('video')?.videoWidth > 0, { timeout: 15000 }); await wait(200); await check(page, `studio ${k} ${w}×${h}`); }
    await page.close();
  });
}
test('party screens (setup, perform) and podcast review fit the window with a 1080p video', async () => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [900, 1000]]) {
    const page = await browser.newPage(); await page.setViewport({ width: w, height: h }); await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en')); await injectFakeMic(page, fx('mic_speech.wav'));
    await page.goto(app.base + `/#/p/${ids.party}`); await page.waitForSelector('#mode-badlip'); await page.click('#mode-badlip'); await page.waitForSelector('#badlip-go'); await page.waitForFunction(() => document.querySelector('.stage video')?.videoWidth > 0); await check(page, `party setup ${w}×${h}`);
    await page.$eval('#match-sounds', (e) => { e.checked = false; }); await page.click('#badlip-go'); await page.waitForSelector('#perform-start', { timeout: 90000 }); await wait(300); await check(page, `party perform ${w}×${h}`);
    await page.goto(app.base + `/#/p/${ids.pod}`); await page.waitForSelector('#wave', { timeout: 30000 }); await page.waitForFunction(() => document.querySelector('.stage video')?.videoWidth > 0); await wait(200); await check(page, `podcast review ${w}×${h}`);
    await page.close();
  }
});
