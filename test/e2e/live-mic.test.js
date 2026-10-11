// Real-hardware test: uses the actual microphone / audio interface. Run with:  LIVE_MIC=1 node --test test/e2e/live-mic.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, fx } from '../helpers.js';
import { launch } from './browser.js';

const LIVE = process.env.LIVE_MIC === '1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('REAL MIC: open, meter, record a take through the studio, transcribe it on-device', { skip: !LIVE && 'set LIVE_MIC=1 to run against real hardware', timeout: 240000 }, async () => {
  const app = await startApp(); const browser = await launch({ realMic: true }); const logs = [];
  try {
    const id = await app.ingestFixture('clip_en.mp4');
    const page = await browser.newPage(); page.on('console', (m) => logs.push(m.text())); page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
    await page.goto(app.base + `/#/p/${id}`); await page.waitForSelector('#timeline-canvas', { timeout: 30000 }); await wait(1500);
    await page.evaluate(() => window.__app.store.commit('x', (p) => { p.settings.preRoll = 1; p.settings.output = 'speakers'; p.settings.muteOriginalWhileRecording = true; }, ['settings']));
    await page.click('#tab-voice'); await page.click('#mic-open');
    await page.waitForFunction(() => window.__app.mic.isOpen, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#mic-device option').length > 0, { timeout: 10000 });
    if (process.env.LIVE_DEVICE) { // e.g. LIVE_DEVICE="USB Audio" -> pick the interface instead of the default input
      const pick = await page.evaluate((re) => { const o = [...document.querySelectorAll('#mic-device option')].find((x) => new RegExp(re, 'i').test(x.textContent)); if (!o) return null; document.querySelector('#mic-device').value = o.value; document.querySelector('#mic-device').dispatchEvent(new Event('change')); return o.textContent; }, process.env.LIVE_DEVICE);
      assert.ok(pick, `no input device matching /${process.env.LIVE_DEVICE}/ — saw: ` + (await page.$$eval('#mic-device option', (o) => o.map((x) => x.textContent).join(' | '))));
      console.log('   selected device:', pick); await wait(1200);
    }
    const info = await page.evaluate(() => ({ ...window.__app.mic.info }));
    const info2 = await page.evaluate(() => ({ ...window.__app.mic.info })); Object.assign(info, info2);
    console.log('   device:', info.label, '|', info.channelCount, 'ch |', info.sampleRate, 'Hz');
    const devices = await page.$$eval('#mic-device option', (o) => o.map((x) => x.textContent)); console.log('   inputs listed:', devices.join(' / '));
    // level meter sees real signal
    const levels = await page.evaluate(() => new Promise((res) => { const out = []; const off = window.__app.mic.on('level', (l) => out.push(l.peakDb)); setTimeout(() => { off(); res(out); }, 2500); }));
    const maxDb = Math.max(...levels); console.log('   live meter peak over 2.5 s:', maxDb.toFixed(1), 'dBFS');
    assert.ok(levels.length > 20, 'meter events arrive'); assert.ok(maxDb > -90, 'non-digital-silence from the real mic');
    // mic check advice
    const chk = await page.evaluate(() => window.__app.mic.check({ silenceSec: 1, speakSec: 3 })); console.log('   mic check:', JSON.stringify({ advice: chk.advice, noise: Math.round(chk.noiseDb), speech: Math.round(chk.speechDb), peak: Math.round(chk.peakDb), trim: Math.round(chk.suggestedGainDb) }));
    // record 7 s through the real pipeline
    await page.evaluate(() => { const a = window.__app; a.mic.setGainDb(Math.max(0, Math.min(30, a.mic.settings.gainDb))); a.engine.seek(1); });
    await page.click('#rec'); await page.waitForFunction(() => window.__app.session.state === 'recording', { timeout: 15000 }); await wait(7000);
    await page.click('#rec'); await page.waitForFunction(() => window.__app.session.state === 'idle', { timeout: 15000 });
    const clip = await page.evaluate(() => window.__app.project.tracks[0].clips[0]); assert.ok(clip, 'a clip exists'); console.log('   clip:', clip.start.toFixed(3), 's +', clip.duration.toFixed(2), 's');
    await page.evaluate(() => window.__app.session.flushUploads());
    const stats = await page.evaluate((f) => { const d = window.__app.engine.assets.takes.get(f).getChannelData(0); let s = 0, pk = 0; for (const v of d) { s += v * v; pk = Math.max(pk, Math.abs(v)); } return { rms: Math.sqrt(s / d.length), pk }; }, clip.file);
    console.log('   take level: rms', (20 * Math.log10(stats.rms)).toFixed(1), 'dBFS, peak', (20 * Math.log10(stats.pk)).toFixed(1), 'dBFS');
    assert.ok(stats.rms > 1e-4, 'recorded take has signal');
    // transcribe the recorded take on-device (Spanish)
    const text = await page.evaluate(async (file, pid) => {
      const { load16k, transcribe } = await import('/js/stt/client.js'); const audio = await load16k(`/media/${pid}/takes/${file}`);
      return (await transcribe(audio, { model: 'Xenova/whisper-base', language: 'spanish' })).text;
    }, clip.file, id);
    console.log('   on-device transcript of the recorded take:', JSON.stringify(text));
    assert.ok(text.trim().length > 5, 'speech recognised from the real recording');
    assert.deepEqual(logs.filter((l) => /PAGEERROR/.test(l)), []);
  } finally { await browser.close(); await app.close(); }
});
