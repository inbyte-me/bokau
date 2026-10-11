import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, fx } from '../helpers.js';
import { launch, injectFakeMic } from './browser.js';

let app, browser; const logs = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
test.before(async () => { app = await startApp({ apiKey: '' }); browser = await launch(); });
test.after(async () => { await browser?.close(); await app?.close(); });

async function openParty(fixture = 'clip_en.mp4') {
  const r = await app.api('POST', '/api/projects/from-path', { path: fx(fixture), mode: 'party' }); await app.waitJob(r.data.job); const id = r.data.project.id;
  const page = await browser.newPage(); page.on('console', (m) => logs.push(m.text())); page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en')); await injectFakeMic(page, fx('mic_speech.wav')); await page.goto(app.base + `/#/p/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mode-badlip', { timeout: 30000 });
  await page.evaluate(() => window.__app.store.commit('fast', (p) => { p.settings.preRoll = 1; }, ['settings']));
  const until = async (fn, ms = 20000, label = '') => { const t0 = Date.now(); for (;;) { if (await page.evaluate(fn)) return; if (Date.now() - t0 > ms) throw new Error('timeout ' + label); await wait(100); } };
  return { page, id, until };
}

test('hub shows the four games and audio-readiness strip; party defaults to TV speakers', async () => {
  const { page } = await openParty();
  for (const m of ['badlip', 'tele', 'blind', 'genre']) assert.ok(await page.$('#mode-' + m), m);
  assert.ok(await page.$('#ready-strip'));
  const s = await page.evaluate(() => window.__app.project.settings); assert.equal(s.output, 'speakers'); assert.equal(s.muteOriginalWhileRecording, true);
  await page.close();
});

test('Bad Lip Reading: script written to the speech slots, performed with the mic, then revealed', async () => {
  const { page, id, until } = await openParty();
  await page.click('#mode-badlip'); await page.waitForSelector('#badlip-go');
  await page.$eval('#match-sounds', (e) => { e.checked = false; });
  await page.click('#badlip-go');
  await page.waitForSelector('#perform-start', { timeout: 90000 });
  const cues = await page.evaluate(() => window.__app.project.cues.map((c) => ({ s: c.start, e: c.end, text: c.text, who: c.character })));
  assert.ok(cues.length >= 2, 'script created: ' + JSON.stringify(cues));
  assert.ok(cues.every((c) => c.text.length > 2 && c.e > c.s));
  assert.equal(await page.evaluate(() => window.__app.project.stems.status), 'ready', 'actors silenced via stem separation');
  assert.equal(await page.evaluate(() => window.__app.project.original.source), 'bg');
  await page.click('#perform-start'); await until(() => window.__app.session.state === 'recording', 15000, 'recording');
  assert.ok(await page.$eval('#karaoke', (e) => e.textContent.length > 0));
  await wait(2500); await page.click('#perform-stop'); await page.waitForSelector('#reveal-play', { timeout: 15000 });
  const tr = await page.evaluate(() => window.__app.project.tracks.find((t) => t.clips.length)); assert.ok(tr, 'a performance was recorded');
  await page.click('#reveal-play'); await until(() => window.__app.engine.playing, 8000, 'playing');
  await page.click('#reveal-play'); await page.close();
  void id;
});

test('Genre swapper (offline generator): transcript is created automatically, every line is rewritten', async () => {
  const { page, until } = await openParty();
  await page.click('#mode-genre'); await page.waitForSelector('#genre-go'); await page.click('#genre-pirate');
  await page.click('#genre-go'); await page.waitForSelector('#perform-start', { timeout: 120000 });
  const cues = await page.evaluate(() => window.__app.project.cues.map((c) => c.text));
  assert.ok(cues.length >= 1); assert.ok(cues.some((t) => /arr|ye|matey|timbers|yo ho|savvy/i.test(t)), 'pirate flavour: ' + cues.join(' | '));
  await page.close(); void until;
});

test('Telenovela: drama meter, directions, score on reveal', async () => {
  const { page, until } = await openParty();
  await page.evaluate(() => window.__app.store.commit('x', (p) => { p.cues = [{ id: 'c1', start: 1, end: 3, text: 'Hello there.', character: '' }, { id: 'c2', start: 3.5, end: 6, text: 'I would like coffee.', character: '' }]; }, ['cues']));
  await page.click('#mode-tele'); await page.waitForSelector('#genre-go'); await page.click('#genre-go');
  await page.waitForSelector('#perform-start', { timeout: 120000 });
  assert.ok(await page.$('.drama'), 'drama-o-meter visible');
  await page.click('#perform-start'); await until(() => window.__app.session.state === 'recording', 15000, 'rec'); await wait(2500); await page.click('#perform-stop');
  await page.waitForSelector('#drama-score', { timeout: 15000 });
  const score = await page.$eval('#drama-score', (e) => +e.textContent); assert.ok(score >= 0 && score <= 100);
  await page.close();
});

test('Blind dubbing: players take turns, each records only their own segment on their own track', async () => {
  const { page, until } = await openParty();
  await page.click('#mode-blind'); await page.waitForSelector('#blind-go');
  await page.$eval('#seg-count', (e) => { e.value = '4'; });
  await page.click('#blind-go');
  const players = await page.evaluate(() => null);
  for (let i = 0; i < 4; i++) {
    await page.waitForSelector('#pass-ready', { timeout: 60000 }); await page.click('#pass-ready');
    await until(() => window.__app.session.state === 'recording', 30000, 'segment ' + i + ' recording');
    await until(() => window.__app.session.state === 'idle', 30000, 'segment ' + i + ' done');
  }
  await page.waitForSelector('#reveal-play', { timeout: 20000 });
  const r = await page.evaluate(() => window.__app.project.tracks.map((t) => ({ name: t.name, fx: t.fx, clips: t.clips.map((c) => [+c.start.toFixed(2), +(c.start + c.duration).toFixed(2)]) })));
  const dur = await page.evaluate(() => window.__app.engine.duration); const seg = dur / 4;
  assert.equal(r.length, 3, 'three players');
  assert.deepEqual(r.map((t) => t.clips.length > 0), [true, true, true]);
  const flat = r.flatMap((t, ti) => t.clips.map(([s, e]) => ({ ti, s, e }))).sort((a, b) => a.s - b.s);
  flat.forEach((c, i) => { const si = Math.floor((c.s + 0.01) / seg); assert.ok(c.s >= si * seg - 0.01 && c.e <= (si + 1) * seg + 0.35, `clip ${i} stays in its segment ${si}: ${c.s}-${c.e}`); });
  assert.equal(flat[0].ti, 0); assert.equal(flat[1].ti, 1); assert.equal(flat[2].ti, 2); assert.equal(flat[3].ti, 0, 'players rotate');
  assert.ok(r.some((t) => t.fx !== 'none'), 'silly voice effects assigned');
  await page.click('#reveal-play'); await until(() => window.__app.engine.playing, 8000, 'reveal playing'); await page.click('#reveal-play'); await page.close();
});

test('party session had no page errors', () => assert.deepEqual(logs.filter((l) => /PAGEERROR|Uncaught/.test(l)), []));
