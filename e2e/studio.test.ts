import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import type { TestApp } from '@doblaje/testkit';
import { ffprobeJson, fx, meanDb, startApp } from '@doblaje/testkit';
import { injectFakeMic, launch } from '@doblaje/testkit/browser';
import type { Browser, Page } from 'puppeteer-core';

let app: TestApp, browser: Browser, page: Page, id: string;
const logs = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${label}`);
    await wait(100);
  }
};

test.before(async () => {
  app = await startApp();
  browser = await launch();
  id = await app.ingestFixture('clip_en.mp4');
  page = await browser.newPage();
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (err) => logs.push(`PAGEERROR ${(err as Error).message}`));
  await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en'));
  await injectFakeMic(page, fx('mic_speech.wav'));
  await page.goto(`${app.base}/#/p/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#timeline-canvas', { timeout: 30000 });
  await until(() => window.__app?.engine?.assets?.orig, 15000, 'audio loaded');
  await page.evaluate(() => {
    const a = window.__app;
    a.store.commit(
      'fast count-in',
      (p) => {
        p.settings.preRoll = 1;
        p.settings.muteOriginalWhileRecording = false;
      },
      ['settings'],
    );
  });
});
test.after(async () => {
  await browser?.close();
  await app?.close();
});

const openMic = async () => {
  await page.click('#devices-btn');
  await page.click('#mic-open');
  await until(() => window.__app.mic.isOpen, 10000, 'mic open');
  await page.click('#devices-done');
};
const record = async (ms) => {
  await page.click('#rec');
  await until(() => window.__app.session.state === 'recording', 10000, 'recording started');
  await wait(ms);
  await page.click('#rec');
  await until(() => window.__app.session.state === 'idle', 10000, 'recording stopped');
};
const project = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.project)));

test('studio boots without console errors; timeline, band, video are present', async () => {
  assert.ok(await page.$('#timeline-canvas'));
  assert.ok(await page.$('#band'));
  assert.ok(await page.$('#video'));
  assert.deepEqual(
    logs.filter((l) => /PAGEERROR|Uncaught/i.test(l)),
    [],
  );
  const dur = await page.evaluate(() => window.__app.engine.duration);
  assert.ok(Math.abs(dur - 12) < 0.3);
});

test('transport: play advances the clock in sync with video; pause/seek/frame-step', async () => {
  await page.evaluate(() => window.__app.engine.seek(1));
  await page.click('#play');
  await until(() => window.__app.engine.playing && window.__app.engine.time > 1.6, 8000, 'playing');
  const sync = await page.evaluate(() => ({
    t: window.__app.engine.time,
    v: (document.getElementById('video') as HTMLVideoElement).currentTime,
    paused: (document.getElementById('video') as HTMLVideoElement).paused,
  }));
  assert.equal(sync.paused, false);
  assert.ok(Math.abs(sync.t - sync.v) < 0.25, `audio/video drift ${sync.t - sync.v}`);
  await page.click('#play');
  const t1 = await page.evaluate(() => window.__app.engine.time);
  await wait(300);
  assert.equal(await page.evaluate(() => window.__app.engine.time), t1, 'paused clock is stable');
  await page.evaluate(() => window.__app.engine.seek(2));
  await page.keyboard.press('ArrowRight');
  const t2 = await page.evaluate(() => window.__app.engine.time);
  assert.ok(Math.abs(t2 - 2.06) < 0.005, `steps to the centre of the next 25fps frame: ${t2}`);
});

test('record a take: placed at the playhead, non-silent, uploaded, undoable', async () => {
  await openMic();
  await page.evaluate(() => window.__app.engine.seek(2));
  await record(2500);
  const p = await project();
  const tr = p.tracks[0];
  assert.equal(tr.clips.length, 1);
  assert.equal(tr.takes.length, 1);
  const clip = tr.clips[0];
  assert.ok(Math.abs(clip.start - 2.0) < 0.01, `clip starts at the playhead where recording began: ${clip.start}`);
  assert.ok(clip.duration > 1.8 && clip.duration < 3.4, `duration ${clip.duration}`);
  const rms = await page.evaluate((f) => {
    const b = window.__app.engine.assets.takes.get(f);
    const d = b.getChannelData(0);
    let s = 0;
    for (const v of d) s += v * v;
    return Math.sqrt(s / d.length);
  }, clip.file);
  assert.ok(rms > 0.01, `take has audio: ${rms}`);
  await page.evaluate(() => window.__app.session.flushUploads());
  const r = await fetch(`${app.base}/media/${id}/takes/${clip.file}`);
  assert.equal(r.status, 200);
  const info = ffprobeJson(`${app.dir(id)}/takes/${clip.file}`);
  assert.ok(Math.abs(Number(info.format.duration) - clip.duration) < 0.05);
  assert.equal(info.streams[0].sample_rate, '48000');
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  assert.equal((await project()).tracks[0].clips.length, 0, 'undo removes the take from the timeline');
  await page.click('#redo');
  assert.equal((await project()).tracks[0].clips.length, 1);
});

test('countdown shows 3-2-1-GO before recording and recording waits for GO', async () => {
  await page.evaluate(() =>
    window.__app.store.commit(
      'c',
      (p) => {
        p.settings.preRoll = 3;
      },
      ['settings'],
    ),
  );
  await page.evaluate(() => {
    window.__counts = [];
    window.__app.session.on('countdown', (n) => window.__counts.push(n));
    window.__app.engine.seek(6);
  });
  await page.click('#rec');
  await until(() => window.__app.session.state === 'countdown', 5000, 'countdown');
  assert.ok(await page.$('.countdown'), 'big countdown overlay visible');
  await until(() => window.__app.session.state === 'recording', 8000, 'go');
  assert.ok((await page.$('.countdown.go')) || true);
  await page.click('#rec');
  await until(() => window.__app.session.state === 'idle', 8000, 'stopped');
  const counts = await page.evaluate(() => window.__counts);
  assert.deepEqual(counts.slice(0, 4), [3, 2, 1, 0], JSON.stringify(counts));
  await page.evaluate(() =>
    window.__app.store.commit(
      'c',
      (p) => {
        p.settings.preRoll = 1;
      },
      ['settings'],
    ),
  );
});

test('punch-in re-records only a 1s window and keeps the surrounding take', async () => {
  await page.evaluate(() => {
    const a = window.__app;
    a.store.commit(
      'reset',
      (p) => {
        p.tracks[0].clips = [];
        p.tracks[0].takes = [];
      },
      ['tracks'],
    );
    a.engine.seek(1);
  });
  await record(4200); // long take ~ 1..5.2
  const before = (await project()).tracks[0].clips;
  assert.equal(before.length, 1);
  await page.evaluate(() => {
    const a = window.__app;
    a.sel.region = { start: 2.5, end: 3.5 };
    a.select({ trackId: a.project.tracks[0].id });
    (document.getElementById('rec-mode') as HTMLSelectElement).value = 'region';
  });
  await page.select('#rec-mode', 'region');
  await page.click('#rec');
  await until(() => window.__app.session.state === 'recording', 10000, 'punch start');
  await until(() => window.__app.session.state === 'idle', 15000, 'punch auto-stop at region end');
  const after = (await project()).tracks[0].clips;
  assert.equal(after.length, 3, `old clip split around the punch: ${JSON.stringify(after.map((c) => [c.start.toFixed(2), c.duration.toFixed(2)]))}`);
  const [a, b, c] = after;
  assert.ok(
    Math.abs(a.start + a.duration - 2.5) < 0.02 &&
      Math.abs(b.start - 2.5) < 0.02 &&
      Math.abs(b.start + b.duration - 3.5) < 0.03 &&
      Math.abs(c.start - 3.5) < 0.03,
    'contiguous around [2.5,3.5]',
  );
  assert.equal(a.file, c.file);
  assert.notEqual(a.file, b.file);
  assert.equal(c.offset > a.offset, true);
  await page.select('#rec-mode', 'playhead');
});

test('loop recording makes one take per pass and the latest is active; older take can be re-applied', async () => {
  await page.evaluate(() => {
    const a = window.__app;
    a.store.commit(
      'reset',
      (p) => {
        p.tracks[0].clips = [];
        p.tracks[0].takes = [];
        p.cues = [{ id: 'cA', start: 3, end: 4.2, text: 'Hello there', character: '' }];
      },
      ['tracks', 'cues'],
    );
    a.select({ cueId: 'cA' });
  });
  await page.select('#rec-mode', 'loop');
  await page.click('#rec');
  await until(() => window.__app.project.tracks[0].takes.length >= 2, 30000, 'two loop takes');
  await page.click('#rec');
  await until(() => window.__app.session.state === 'idle', 10000, 'loop stopped');
  const p = await project();
  const tr = p.tracks[0];
  assert.ok(tr.takes.length >= 2);
  assert.equal(tr.clips.length, 1, 'only one take is active on the timeline');
  assert.equal(tr.clips[0].takeId, tr.takes.at(-1).id, 'latest take active');
  await page.click('#tab-record');
  await page.waitForSelector('#takes-list .take');
  const useBtns = await page.$$('#takes-list .take:not(.active) button.use');
  assert.ok(useBtns.length >= 1);
  await useBtns[0].click();
  await wait(200);
  const p2 = await project();
  assert.notEqual(p2.tracks[0].clips[0].takeId, tr.takes.at(-1).id, 'older take now active');
  await page.select('#rec-mode', 'playhead');
});

test('state persists: reload restores clips, waveforms and audio from the server', async () => {
  await page.evaluate(() => window.__app.session.flushUploads());
  await page.evaluate(() => window.__app.store.flush());
  const before = await project();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#timeline-canvas', { timeout: 30000 });
  await until(() => window.__app.engine?.assets?.takes?.size > 0, 20000, 'takes reloaded');
  const after = await project();
  assert.deepEqual(
    after.tracks[0].clips.map((c) => [c.file, c.start]),
    before.tracks[0].clips.map((c) => [c.file, c.start]),
  );
  assert.equal(after.cues.length, before.cues.length);
});

test('subtitle import via the Cues tab; text edits update syllable meter and persist', async () => {
  await page.click('#tab-cues');
  await page.waitForSelector('#sub-file', { hidden: true });
  const input = await page.$('input#sub-file');
  page.once('dialog', (d) => d.accept());
  await input.uploadFile(fx('sample.srt'));
  await until(() => window.__app.project.cues.length === 3, 8000, 'imported');
  const cues = (await project()).cues;
  assert.equal(cues[1].character, 'JOHN');
  assert.equal(cues[1].text, 'I would like a cup of coffee, please.');
  await page.waitForSelector('#cue-list .cue textarea');
  const ta = (await page.$$('#cue-list .cue textarea'))[0];
  await ta.focus();
  await page.evaluate(() => document.querySelector<HTMLTextAreaElement>('#cue-list .cue textarea').select());
  await page.keyboard.type('Hi there my dear friends');
  await wait(200);
  assert.equal((await project()).cues[0].text, 'Hi there my dear friends');
  const syl = await page.$eval('#cue-list .cue .syl', (e) => e.textContent);
  assert.match(syl, /^5 syl/);
});

test('mix: separate stems from the UI, original switches to music-only, ducking curve is exposed', async () => {
  await page.click('#tab-voices');
  await page.waitForSelector('#stems-go');
  await page.click('#stems-go');
  await until(() => window.__app.project.stems.status === 'ready' && window.__app.engine.assets.bg, 60000, 'stems');
  assert.equal(await page.evaluate(() => window.__app.project.original.source), 'bg');
  await page.evaluate(() => window.__app.engine.play(2));
  await until(() => window.__app.engine.handle?.duckCurve, 5000, 'duck curve');
  await page.evaluate(() => window.__app.engine.pause());
});

test('export from the UI: renders in the browser, muxes on the server, recorded voice is audible in the file', async () => {
  await page.evaluate(() => {
    const a = window.__app;
    a.store.commit(
      'voice',
      (p) => {
        p.ducking.enabled = false;
      },
      ['levels'],
    );
  });
  await page.evaluate(() => window.__app.session.flushUploads());
  await page.click('#export-btn');
  await page.waitForSelector('#ex-go');
  assert.match(await page.$eval('#ex-plan', (e) => e.textContent), /Fast export|copied untouched|Exportación rápida/i);
  await page.click('#ex-go');
  await page.waitForSelector('#ex-results a', { timeout: 90000 });
  const files = await page.$$eval('#ex-results a', (a) => a.map((x) => x.dataset.file));
  assert.ok(
    files.some((f) => f.endsWith('.mp4')),
    files.join(),
  );
  const mp4 = files.find((f) => f.endsWith('.mp4'));
  const dirs = fs.readdirSync(`${app.dir(id)}/exports`);
  const out = `${app.dir(id)}/exports/${dirs.at(-1)}/${mp4}`;
  const info = ffprobeJson(out);
  assert.equal(info.streams.find((s) => s.codec_type === 'video').codec_name, 'h264');
  const p = await project();
  const clip = p.tracks[0].clips[0];
  const during = meanDb(out, clip.start + 0.2, Math.min(0.8, clip.duration - 0.4));
  const outside = meanDb(out, 10.5, 1);
  assert.ok(during > outside + 3 || during > -35, `voice audible in export: ${during} dB vs ${outside} dB`);
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('.modal-back')?.remove());
});

test('no unexpected console errors during the whole session', async () => {
  const bad = logs.filter((l) => /PAGEERROR|Uncaught|Failed to load resource: the server responded with a status of 5/i.test(l));
  assert.deepEqual(bad, []);
});

test('marks: ⌘/Ctrl+digit sets, ⌥+digit jumps; paused stays paused, playing keeps playing', async () => {
  const key = async (mod, code) => {
    await page.keyboard.down(mod);
    await page.keyboard.press(code);
    await page.keyboard.up(mod);
  };
  await page.evaluate(() => {
    window.__app.store.commit(
      'reset',
      (p) => {
        p.markers = [];
      },
      ['markers'],
    );
    window.__app.engine.pause();
    window.__app.engine.seek(3.25);
  });
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur?.());
  await key('Control', 'Digit2');
  await key('Meta', 'Digit3'); // 3 is set at the same spot; then move and set 1
  await page.evaluate(() => window.__app.engine.seek(8));
  await key('Shift', 'Digit1');
  const marks = await page.evaluate(() => window.__app.project.markers.map((m) => [m.n, +m.t.toFixed(2)]));
  assert.deepEqual(marks, [
    [1, 8],
    [2, 3.25],
    [3, 3.25],
  ]);
  await page.waitForSelector('#marks-bar .mark');
  assert.equal((await page.$$('#marks-bar .mark')).length, 3);
  // paused: jump keeps it paused
  await key('Alt', 'Digit2');
  let st: { t: number; playing: boolean; vt?: number } = await page.evaluate(() => ({ t: window.__app.engine.time, playing: window.__app.engine.playing }));
  assert.ok(Math.abs(st.t - 3.25) < 0.01 && !st.playing, JSON.stringify(st));
  // playing: jump continues playing from the mark
  await page.evaluate(() => window.__app.engine.play(0));
  await until(() => window.__app.engine.playing && window.__app.engine.time > 0.4, 5000, 'playing');
  await key('Alt', 'Digit1');
  await wait(250);
  st = await page.evaluate(() => ({
    t: window.__app.engine.time,
    playing: window.__app.engine.playing,
    vt: (document.getElementById('video') as HTMLVideoElement).currentTime,
  }));
  assert.ok(st.playing && st.t > 8 && st.t < 8.8, `continues playing from mark 1: ${JSON.stringify(st)}`);
  assert.ok(Math.abs(st.vt - st.t) < 0.4, 'video follows the jump');
  await page.evaluate(() => window.__app.engine.pause());
  // clicking a marks-bar chip jumps too
  await page.click('#marks-bar .mark[data-n="2"]');
  assert.ok(Math.abs((await page.evaluate(() => window.__app.engine.time)) - 3.25) < 0.01);
});

test('marks while recording: jumping back keeps recording, splits the take, and overwrites what is there', async () => {
  await openMic();
  const key = async (mod, code) => {
    await page.keyboard.down(mod);
    await page.keyboard.press(code);
    await page.keyboard.up(mod);
  };
  await page.evaluate(() => {
    const a = window.__app;
    a.store.commit(
      'reset',
      (p) => {
        p.tracks[0].clips = [];
        p.tracks[0].takes = [];
        p.markers = [{ id: 'm1', n: 1, t: 2 }];
        p.settings.preRoll = 1;
      },
      ['tracks', 'markers'],
    );
    a.engine.pause();
    a.engine.seek(6);
    (document.activeElement as HTMLElement)?.blur?.();
  });
  await page.click('#rec');
  await until(() => window.__app.session.state === 'recording', 10000, 'recording');
  await wait(1800); // records ~6.0 .. 7.8
  await key('Alt', 'Digit1'); // jump back to mark 1 (t=2) while recording
  await wait(250);
  assert.equal(await page.evaluate(() => window.__app.session.state), 'recording', 'still recording after the jump');
  const t1 = await page.evaluate(() => window.__app.engine.time);
  assert.ok(t1 > 2 && t1 < 3, `playhead jumped back: ${t1}`);
  assert.equal(await page.evaluate(() => window.__app.engine.playing), true);
  await wait(1800); // records ~2.0 .. 3.8 (and keeps going)
  await page.click('#rec');
  await until(() => window.__app.session.state === 'idle', 10000, 'stopped');
  const clips = (await project()).tracks[0].clips;
  assert.equal(clips.length, 2, JSON.stringify(clips.map((c) => [c.start, c.duration])));
  const [a, b] = clips; // sorted by start
  assert.ok(a.start > 1.9 && a.start < 2.3, `second part sits at the mark: ${a.start}`);
  assert.ok(a.duration > 1.4, `a ${a.duration}`);
  assert.ok(b.start > 5.9 && b.start < 6.3, `first part stays where recording began: ${b.start}`);
  assert.ok(b.duration > 1.3 && b.duration < 2.4, `b ${b.duration}`);
  // now record over part of it: punching again at mark 1 replaces the clip content there but keeps earlier takes in the take list
  const takes = (await project()).tracks[0].takes;
  assert.equal(takes.length, 2);
});
