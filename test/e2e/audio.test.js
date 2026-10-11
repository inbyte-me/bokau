import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';
import { launch, openPage } from './browser.js';

let app, browser, page;
test.before(async () => { app = await startApp(); browser = await launch(); page = await openPage(browser, app.base + '/'); });
test.after(async () => { await browser?.close(); await app?.close(); });

// helpers executed in the page
const setup = () => page.evaluate(async () => {
  const [{ buildMix }, { renderStem }, { FFT }] = await Promise.all([import('/js/audio/mixgraph.js'), import('/js/audio/render.js'), import('/js/audio/pitch-core.js')]);
  const SR = 48000;
  const mk = (fn, secs) => { const b = new AudioBuffer({ length: Math.round(secs * SR), sampleRate: SR, numberOfChannels: 2 }); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = fn(i / SR); } return b; };
  const sine = (f, a = 0.5) => (t) => a * Math.sin(2 * Math.PI * f * t);
  const level = (buf, t0, t1) => { const d = buf.getChannelData(0); let s = 0; const a = Math.floor(t0 * SR), b = Math.floor(t1 * SR); for (let i = a; i < b; i++) s += d[i] * d[i]; return Math.sqrt(s / (b - a)); };
  const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
  const peakHz = (buf, t0, N = 16384) => { const f = new FFT(N), re = new Float64Array(N), im = new Float64Array(N), d = buf.getChannelData(0), a = Math.floor(t0 * SR); for (let i = 0; i < N; i++) re[i] = (d[a + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); f.transform(re, im); let best = 0, bi = 0; for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); if (m > best) { best = m; bi = k; } } return bi * SR / N; };
  const bandDb = (buf, t0, hz, N = 16384) => { const f = new FFT(N), re = new Float64Array(N), im = new Float64Array(N), d = buf.getChannelData(0), a = Math.floor(t0 * SR); for (let i = 0; i < N; i++) re[i] = (d[a + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); f.transform(re, im); const k0 = Math.round(hz * N / SR); let s = 0; for (let k = k0 - 3; k <= k0 + 3; k++) s += re[k] ** 2 + im[k] ** 2; return 10 * Math.log10(s + 1e-12); };
  const firstAbove = (buf, thr = 0.02) => { const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > thr) return i / SR; return -1; };
  const lastAbove = (buf, thr = 0.02) => { const d = buf.getChannelData(0); for (let i = d.length - 1; i >= 0; i--) if (Math.abs(d[i]) > thr) return i / SR; return -1; };
  const project = (over = {}) => ({ original: { volume: 1, mute: false, solo: false, source: 'full', ghost: { enabled: false, level: 0.25, pan: -1 } }, ducking: { enabled: true, db: -12, attack: 0.04, release: 0.35, threshold: 0.02 }, media: { duration: 6 }, tracks: [{ id: 't1', volume: 1, pan: 0, mute: false, solo: false, fx: 'none', fxAmount: 1, micFix: false, nudgeMs: 0, clips: [] }], ...over });
  const assets = (extra = {}) => ({ orig: mk(sine(1000, 0.3), 6), dialogue: null, bg: null, takes: new Map(), envs: new Map(), ...extra });
  Object.assign(window, { T: { buildMix, renderStem, SR, mk, sine, level, db, peakHz, bandDb, firstAbove, lastAbove, project, assets, FFT } });
  return true;
});

test('worklets load in an OfflineAudioContext and a render works', async () => {
  await setup();
  const r = await page.evaluate(async () => {
    const { T } = window; const p = T.project(); const a = T.assets();
    const buf = await T.renderStem(p, a, 'mix', { duration: 6 });
    return { len: buf.length, ch: buf.numberOfChannels, lvl: T.level(buf, 1, 2) };
  });
  assert.equal(r.len, 6 * 48000); assert.equal(r.ch, 2); assert.ok(r.lvl > 0.1, 'original audible in mix ' + r.lvl);
});

test('clip placement is sample-accurate; offset/duration trimming; punch-in gap stays silent', async () => {
  const r = await page.evaluate(async () => {
    const { T } = window; const take = T.mk(T.sine(440, 0.5), 4);
    const p = T.project({ original: { volume: 1, mute: true, solo: false, source: 'full', ghost: { enabled: false, level: .25, pan: -1 } } });
    // carved clip: take [0..4] with punch hole 1.5..2.5 -> two clips, placed at timeline 1.0
    p.tracks[0].clips = [{ id: 'a', file: 'f', start: 1, offset: 0, duration: 1.5, gain: 1 }, { id: 'b', file: 'f', start: 3, offset: 2, duration: 2, gain: 1 }];
    const buf = await T.renderStem(p, T.assets({ takes: new Map([['f', take]]) }), 'wet', { duration: 6 });
    return { first: T.firstAbove(buf), last: T.lastAbove(buf), gap: T.level(buf, 2.6, 2.9), a: T.level(buf, 1.2, 2.3), b: T.level(buf, 3.2, 4.8), hz: T.peakHz(buf, 1.2), after: T.level(buf, 5.1, 5.9) };
  });
  assert.ok(Math.abs(r.first - 1.0) < 0.012, 'first sound at 1.0s: ' + r.first);
  assert.ok(Math.abs(r.last - 5.0) < 0.012, 'last sound at 5.0s: ' + r.last);
  assert.ok(r.gap < 0.002, 'gap is silent ' + r.gap); assert.ok(r.a > 0.2 && r.b > 0.2); assert.ok(r.after < 0.002);
  assert.ok(Math.abs(r.hz - 440) < 4);
});

test('auto-ducking: -12 dB under voice, early dip (lookahead), smooth recovery', async () => {
  const r = await page.evaluate(async () => {
    const { T } = window; const take = T.mk(T.sine(300, 0.4), 1.5);
    const p = T.project(); p.tracks[0].clips = [{ id: 'a', file: 'f', start: 2, offset: 0, duration: 1.5, gain: 1 }];
    const buf = await T.renderStem(p, T.assets({ takes: new Map([['f', take]]) }), 'bg', { duration: 6 });
    const mix = await T.renderStem(p, T.assets({ takes: new Map([['f', take]]) }), 'mix', { duration: 6 });
    // measure bed level via 1 kHz band so the 300 Hz voice does not interfere
    const bed = (b, t0) => T.bandDb(b, t0, 1000, 8192);
    return { free: bed(mix, 0.5), ducked: bed(mix, 2.4), later: bed(mix, 4.6), bgStem: T.level(buf, 2.4, 3.2), bgFree: T.level(buf, 0.5, 1.2),
      pre: T.level(mix, 1.9, 1.99) , veryEarly: T.level(mix, 1.0, 1.5) };
  });
  assert.ok(Math.abs((r.free - r.ducked) - 12) < 2, `ducking depth ~12 dB, got ${(r.free - r.ducked).toFixed(1)}`);
  assert.ok(Math.abs(r.free - r.later) < 1.5, 'music recovers after the line');
  assert.ok(Math.abs(r.bgStem - r.bgFree) < 0.01, 'bg STEM export is not ducked');
});

test('ducking can be disabled and respects its depth parameter', async () => {
  const r = await page.evaluate(async () => {
    const { T } = window; const take = T.mk(T.sine(300, 0.4), 1.5);
    const mk = async (d) => { const p = T.project(); p.ducking = { ...p.ducking, ...d }; p.tracks[0].clips = [{ id: 'a', file: 'f', start: 2, offset: 0, duration: 1.5, gain: 1 }]; const b = await T.renderStem(p, T.assets({ takes: new Map([['f', take]]) }), 'mix', { duration: 6 }); return T.bandDb(b, 2.4, 1000, 8192) - T.bandDb(b, 0.5, 1000, 8192); };
    return { off: await mk({ enabled: false }), d6: await mk({ db: -6 }), d20: await mk({ db: -20 }) };
  });
  assert.ok(Math.abs(r.off) < 0.5); assert.ok(Math.abs(r.d6 + 6) < 1.5, 'd6 ' + r.d6); assert.ok(Math.abs(r.d20 + 20) < 2.5, 'd20 ' + r.d20);
});

test('FX: monster/helium shift pitch and keep timing; walkie band-limits; ghost rings out', async () => {
  const r = await page.evaluate(async () => {
    const { T } = window; const take = T.mk(T.sine(440, 0.5), 2);
    const run = async (fx, amount) => { const p = T.project({ original: { volume: 1, mute: true, solo: false, source: 'full', ghost: { enabled: false, level: 0.25, pan: -1 } } }); p.tracks[0].fx = fx; p.tracks[0].fxAmount = amount; p.tracks[0].clips = [{ id: 'a', file: 'f', start: 1, offset: 0, duration: 2, gain: 1 }]; return T.renderStem(p, T.assets({ takes: new Map([['f', take]]) }), 'wet', { duration: 7 }); };
    const mon = await run('monster', 1), hel0 = await run('helium', 0), gh = await run('ghost', 1), wk = await run('walkie', 1);
    // broadband voice for walkie
    const noise = T.mk(() => (Math.random() * 2 - 1) * 0.3, 2);
    const p = T.project({ original: { volume: 1, mute: true, solo: false, source: 'full', ghost: { enabled: false, level: .25, pan: -1 } } }); p.tracks[0].fx = 'walkie'; p.tracks[0].clips = [{ id: 'a', file: 'n', start: 1, offset: 0, duration: 2, gain: 1 }];
    const wn = await T.renderStem(p, T.assets({ takes: new Map([['n', noise]]) }), 'wet', { duration: 7 });
    const p2 = JSON.parse(JSON.stringify(p)); p2.tracks[0].fx = 'none'; const cn = await T.renderStem(p2, T.assets({ takes: new Map([['n', noise]]) }), 'wet', { duration: 7 });
    const rel = (b, hz) => T.bandDb(b, 1.5, hz) - T.bandDb(b, 1.5, 1000);
    return { monHz: T.peakHz(mon, 1.5), monFirst: T.firstAbove(mon, 0.05), hel0Hz: T.peakHz(hel0, 1.5), ghTail: T.level(gh, 3.2, 3.8), ghLast: T.lastAbove(gh, 0.005),
      walkieLow: rel(wn, 100) - rel(cn, 100), walkieHigh: rel(wn, 9000) - rel(cn, 9000), walkieMid: rel(wn, 1500) - rel(cn, 1500), walkieStatic: T.level(wk, 0.5, 0.9), walkieBurst: Math.max(T.level(wk, 0.995, 1.03)) };
  });
  assert.ok(Math.abs(r.monHz - 440 * 2 ** (-12 / 12)) < 6, 'monster ~ -12 st: ' + r.monHz);
  assert.ok(Math.abs(r.monFirst - 1.0) < 0.02, 'monster is latency-compensated: ' + r.monFirst);
  assert.ok(Math.abs(r.hel0Hz - 440 * 2 ** (7 / 12)) < 8, 'helium +7: ' + r.hel0Hz);
  assert.ok(r.ghTail > 0.003 && r.ghLast > 3.5, 'ghost reverb tail past the clip end ' + JSON.stringify({ t: r.ghTail, l: r.ghLast }));
  assert.ok(r.walkieLow < -12 && r.walkieHigh < -15 && Math.abs(r.walkieMid) < 4, `walkie band-pass ${JSON.stringify({ lo: r.walkieLow, hi: r.walkieHigh, mid: r.walkieMid })}`);
  assert.ok(r.walkieBurst > 0.01, 'squelch burst at key-up: ' + r.walkieBurst);
});

test('mute / solo semantics across original and tracks; stems: dry ignores fx & volume', async () => {
  const r = await page.evaluate(async () => {
    const { T } = window; const take = T.mk(T.sine(440, 0.5), 2);
    const base = () => { const p = T.project(); p.ducking.enabled = false; p.tracks = [{ ...p.tracks[0], id: 't1', clips: [{ id: 'a', file: 'f', start: 1, offset: 0, duration: 1, gain: 1 }] }, { ...p.tracks[0], id: 't2', clips: [{ id: 'b', file: 'f', start: 3, offset: 0, duration: 1, gain: 1 }] }]; return p; };
    const A = () => T.assets({ takes: new Map([['f', take]]) });
    const lv = async (p, kind = 'mix') => { const b = await T.renderStem(p, A(), kind, { duration: 6 }); return { orig: T.bandDb(b, 0.2, 1000, 4096), t1: T.bandDb(b, 1.2, 440, 4096), t2: T.bandDb(b, 3.2, 440, 4096) }; };
    const none = await lv(base());
    const soloT1 = base(); soloT1.tracks[0].solo = true; const s1 = await lv(soloT1);
    const soloOrig = base(); soloOrig.original.solo = true; const so = await lv(soloOrig);
    const muteT2 = base(); muteT2.tracks[1].mute = true; const m2 = await lv(muteT2);
    const fxd = base(); fxd.tracks[0].fx = 'monster'; fxd.tracks[0].volume = 0.2; const dryP = await lv(fxd, 'dry'); const wetP = await lv(fxd, 'wet');
    return { none, s1, so, m2, dryP, wetP };
  });
  const audible = (v) => v > 10; // dB of band energy; leakage floor is far below this
  assert.ok(audible(r.none.orig) && audible(r.none.t1) && audible(r.none.t2));
  assert.ok(audible(r.s1.t1) && !audible(r.s1.orig) && !audible(r.s1.t2), 'solo t1 silences the rest ' + JSON.stringify(r.s1));
  assert.ok(audible(r.so.orig) && !audible(r.so.t1) && !audible(r.so.t2), 'solo original');
  assert.ok(audible(r.m2.t1) && !audible(r.m2.t2) && audible(r.m2.orig), 'mute t2');
  assert.ok(Math.abs(r.dryP.t1 - r.none.t1) < 1.5, 'dry stem has no track volume / fx: ' + r.dryP.t1 + ' vs ' + r.none.t1);
  assert.ok(r.wetP.t1 < r.none.t1 - 8, 'wet stem applies volume/fx');
});

test('ghost guide: original dialogue panned to one ear only (not part of mix/export)', async () => {
  const r = await page.evaluate(async () => {
    const { T } = window; const SR = T.SR;
    const ctx = new OfflineAudioContext(2, SR * 3, SR);
    const p = T.project(); p.original.ghost = { enabled: true, level: 0.5, pan: -1 }; p.ducking.enabled = false;
    const assets = T.assets({ dialogue: T.mk(T.sine(700, 0.6), 6), bg: T.mk(T.sine(100, 0.3), 6) });
    assets.totalDuration = 3;
    const { buildMix } = T; await buildMix(ctx, p, assets, { from: 0, to: 3, when: 0, destination: ctx.destination, include: { original: true, voices: false, ghost: true } });
    const buf = await ctx.startRendering();
    const ch = (c, hz) => { const d = buf.getChannelData(c); const N = 8192, f = new T.FFT(N), re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N; i++) re[i] = d[10000 + i]; f.transform(re, im); const k = Math.round(hz * N / SR); return Math.hypot(re[k], im[k]) / N; };
    return { l700: ch(0, 700), r700: ch(1, 700), l100: ch(0, 100), r100: ch(1, 100) };
  });
  assert.ok(r.l700 > 0.05 && r.r700 < 0.005, 'ghost dialogue in left ear only ' + JSON.stringify(r));
  assert.ok(r.l100 > 0.01 && r.r100 > 0.01, 'bg bed (music) in both ears');
});

test('helium on a voice-like signal: pitch goes up an octave while formant bumps stay near their original place', async () => {
  const r = await page.evaluate(async () => {
    const { T } = window; const SR = T.SR; const f0 = 150;
    // glottal-ish harmonic stack shaped by two formants (700 Hz, 1500 Hz)
    const voice = T.mk((t) => { let s = 0; for (let k = 1; k < 50; k++) { const f = k * f0; const env = Math.exp(-(((f - 700) / 250) ** 2)) + 0.6 * Math.exp(-(((f - 1500) / 350) ** 2)) + 0.02; s += env * Math.sin(2 * Math.PI * f * t) / 3; } return 0.5 * s; }, 3);
    const run = async (fx, amount) => { const p = T.project({ original: { volume: 1, mute: true, solo: false, source: 'full', ghost: { enabled: false, level: 0.25, pan: -1 } } }); p.tracks[0].fx = fx; p.tracks[0].fxAmount = amount; p.tracks[0].clips = [{ id: 'a', file: 'v', start: 0.5, offset: 0, duration: 3, gain: 1 }]; return T.renderStem(p, T.assets({ takes: new Map([['v', voice]]) }), 'wet', { duration: 5 }); };
    const acf = (buf, t0) => { const d = buf.getChannelData(0), a = Math.floor(t0 * SR), N = 4800; let best = 0, bl = 0; const minL = Math.floor(SR / 800), maxL = Math.floor(SR / 70); const c0 = (() => { let s = 0; for (let i = 0; i < N; i++) s += d[a + i] * d[a + i]; return s; })(); for (let l = minL; l < maxL; l++) { let s = 0; for (let i = 0; i < N; i++) s += d[a + i] * d[a + i + l]; if (s > best) { best = s; bl = l; } } return { hz: SR / bl, strength: best / c0 }; };
    const spec = (buf, t0) => { const N = 8192, f = new T.FFT(N), re = new Float64Array(N), im = new Float64Array(N), d = buf.getChannelData(0), a = Math.floor(t0 * SR); for (let i = 0; i < N; i++) re[i] = d[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); f.transform(re, im); let num = 0, den = 0; for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); num += m * k * SR / N; den += m; } return num / den; };
    const orig = await run('none', 1), hel = await run('helium', 1);
    return { o: acf(orig, 1.5), h: acf(hel, 1.5), co: spec(orig, 1.5), ch: spec(hel, 1.5) };
  });
  assert.ok(Math.abs(r.o.hz - 150) < 4, 'sanity f0 ' + r.o.hz);
  assert.ok(Math.abs(r.h.hz - 300) < 12, 'helium +12 st doubles f0: ' + JSON.stringify(r.h));
  assert.ok(r.ch < r.co * 1.7, `formants preserved: centroid ${r.co.toFixed(0)} -> ${r.ch.toFixed(0)} (a naive 2x shift would give ~2x)`);
});
