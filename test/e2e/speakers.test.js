import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startApp, fx } from '../helpers.js';
import { launch } from './browser.js';

let app, browser, page, id; const logs = [];
const truth = () => JSON.parse(fs.readFileSync(fx('voices.json'), 'utf8'));
test.before(async () => {
  app = await startApp(); browser = await launch(); id = await app.ingestFixture('clip_voices.mp4');
  await app.waitJob((await app.api('POST', `/api/projects/${id}/stems`, { method: 'auto' })).data.job);
  page = await browser.newPage(); page.on('console', (m) => logs.push(m.text())); page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en'));
  await page.goto(app.base + `/#/p/${id}`); await page.waitForSelector('#timeline-canvas', { timeout: 30000 });
  await page.waitForFunction(() => window.__app.engine?.assets?.dialogue, { timeout: 30000 });
});
test.after(async () => { await browser?.close(); await app?.close(); });

test('identify voices: three distinct speakers found, turns match the ground truth', async () => {
  await page.click('#tab-mix'); await page.waitForSelector('#voices-go'); await page.click('#voices-go');
  await page.waitForFunction(() => window.__app.project.speakers.list.length > 0, { timeout: 280000 });
  const sp = await page.evaluate(() => JSON.parse(JSON.stringify(window.__app.project.speakers)));
  const T = truth(); assert.equal(sp.list.length, 3, 'speakers: ' + JSON.stringify(sp.list.map((s) => s.name)));
  // map each true speaker to the predicted id that covers most of its speech, then score time-weighted accuracy
  const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const byTrue = {}; for (const t of T) { byTrue[t.speaker] ||= {}; for (const g of sp.segments) byTrue[t.speaker][g.speaker] = (byTrue[t.speaker][g.speaker] || 0) + overlap(t, g); }
  const map = Object.fromEntries(Object.entries(byTrue).map(([k, v]) => [k, Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]]));
  assert.equal(new Set(Object.values(map)).size, 3, 'each real voice maps to its own cluster: ' + JSON.stringify(map));
  let good = 0, total = 0; for (const t of T) { total += t.end - t.start; for (const g of sp.segments) if (g.speaker === map[t.speaker]) good += overlap(t, g); }
  assert.ok(good / total > 0.85, `time-weighted accuracy ${(100 * good / total).toFixed(0)}%`);
  await page.evaluate((m) => { window.__map = m; }, map);
  assert.ok(await page.$('.voice-row'), 'voices listed in the Mix tab');
});

test('muting one character silences only that voice in the mix; music and the others stay', async () => {
  const T = truth(); const r = await page.evaluate(async (T) => {
    const { renderStem } = await import('/js/audio/render.js'); const a = window.__app; const A = a.engine.assets; const map = window.__map;
    const rms = (buf, s, e) => { const d = buf.getChannelData(0); const i0 = Math.floor(s * buf.sampleRate), i1 = Math.floor(e * buf.sampleRate); let q = 0; for (let i = i0; i < i1; i++) q += d[i] * d[i]; return Math.sqrt(q / (i1 - i0)); };
    const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
    a.store.commit('no duck', (p) => { p.ducking.enabled = false; }, ['levels']);
    const base = await renderStem(a.project, A, 'mix', { duration: 22 });
    const sam = T.filter((t) => t.speaker === 'Samantha'), dan = T.filter((t) => t.speaker === 'Daniel');
    document.querySelector(`.voice-row[data-speaker="${map.Samantha}"] .voice-mute`).click(); await new Promise((r) => setTimeout(r, 200));
    const muted = await renderStem(a.project, A, 'mix', { duration: 22 });
    const lvl = (b, list) => db(list.reduce((s, t) => s + rms(b, t.start + 0.2, t.end - 0.2) ** 2, 0) / list.length) / 2;
    const bgOnly = await renderStem(a.project, A, 'bg', { duration: 22 });
    return { samBg: lvl(bgOnly, sam), samBefore: lvl(base, sam), samAfter: lvl(muted, sam), danBefore: lvl(base, dan), danAfter: lvl(muted, dan), music: db(rms(muted, 0.1, 0.7)), musicBase: db(rms(base, 0.1, 0.7)), stemUnaffected: db(rms(bgOnly, 3.7, 6.6)) };
  }, T);
  assert.ok(r.samBefore - r.samAfter > 6, `muted voice drops: ${r.samBefore.toFixed(1)} -> ${r.samAfter.toFixed(1)} dB`);
  assert.ok(Math.abs(r.samAfter - r.samBg) < 2.5, `what remains where the character spoke is only the music bed: ${r.samAfter.toFixed(1)} vs music-only ${r.samBg.toFixed(1)} dB`);
  assert.ok(Math.abs(r.danBefore - r.danAfter) < 2.5, `other voice unchanged: ${r.danBefore.toFixed(1)} -> ${r.danAfter.toFixed(1)} dB`);
  assert.ok(Math.abs(r.music - r.musicBase) < 2, 'music bed intact');
});

test('solo, unmute, rename updates cues, and the choice persists across reload', async () => {
  const id0 = await page.evaluate(() => window.__map.Daniel);
  await page.evaluate(() => document.querySelector('.voice-row .voice-mute.on')?.click());
  await page.click(`.voice-row[data-speaker="${id0}"] .voice-solo`); await new Promise((r) => setTimeout(r, 150));
  let st = await page.evaluate(() => window.__app.project.speakers.list.map((s) => [s.id, s.muted, s.solo])); assert.equal(st.filter((x) => x[2]).length, 1);
  await page.click(`.voice-row[data-speaker="${id0}"] .voice-solo`);
  await page.evaluate((i) => window.__app.store.commit('cue', (p) => { p.cues = [{ id: 'q1', start: 3.7, end: 6.6, text: 'Fine thanks', character: p.speakers.list.find((s) => s.id === i).name }]; }, ['cues']), id0);
  const input = await page.$(`.voice-row[data-speaker="${id0}"] input`); await input.focus(); await input.evaluate((el) => el.select()); await page.keyboard.type('Dad'); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => window.__app.project.speakers.list.find((s) => s.name === 'Dad') != null), true, JSON.stringify(await page.evaluate(() => window.__app.project.speakers.list.map((s) => s.name))));
  assert.equal(await page.evaluate(() => window.__app.project.cues[0].character), 'Dad', 'cues follow the rename');
  await page.evaluate(() => window.__app.store.flush()); await page.reload(); await page.waitForSelector('#timeline-canvas', { timeout: 30000 });
  const after = await page.evaluate(() => ({ n: window.__app.project.speakers.list.length, names: window.__app.project.speakers.list.map((s) => s.name), segs: window.__app.project.speakers.segments.length }));
  assert.equal(after.n, 3); assert.ok(after.names.includes('Dad')); assert.ok(after.segs >= 6);
});

test('no page errors', () => assert.deepEqual(logs.filter((l) => /PAGEERROR|Uncaught/.test(l)), []));
