import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startApp, fx, meanDb, ffprobeJson } from '../helpers.js';
import { spawnSync } from 'node:child_process';

let app;
test.before(async () => { app = await startApp(); });
test.after(async () => { await app.close(); });

const runStems = async (id) => { const r = await app.api('POST', `/api/projects/${id}/stems`); return (await app.waitJob(r.data.job)).result; };

test('stereo centre-cut: dialogue stem is speech, background keeps music, dialogue+bg == original', async () => {
  const id = await app.ingestFixture('clip_en.mp4');
  const st = await runStems(id);
  assert.equal(st.status, 'ready'); assert.equal(st.method, 'stereo-center-cut');
  const d = app.dir(id);
  // speech starts at 1.0s: window 0-0.9 is music only, 2-4 has speech
  const dlgMusicOnly = meanDb(d + '/stem_dialogue.wav', 0, 0.9);
  const dlgSpeech = meanDb(d + '/stem_dialogue.wav', 1.5, 2);
  assert.ok(dlgSpeech - dlgMusicOnly > 15, `dialogue stem should be quiet without speech (${dlgMusicOnly} vs ${dlgSpeech})`);
  const origSpeech = meanDb(d + '/audio_orig.wav', 1.5, 2); const bgSpeech = meanDb(d + '/stem_bg.wav', 1.5, 2);
  const origMusic = meanDb(d + '/audio_orig.wav', 0, 0.9); const bgMusic = meanDb(d + '/stem_bg.wav', 0, 0.9);
  assert.ok(origSpeech - bgSpeech > 3, `speech must be reduced in bg (${origSpeech} → ${bgSpeech})`);
  assert.ok(Math.abs(origMusic - bgMusic) < 4, `music must survive in bg (${origMusic} → ${bgMusic})`);
  // reconstruction: dialogue + bg has the same loudness as the original (they differ only by all-pass phase)
  const out = d + '/recon.wav';
  spawnSync('ffmpeg', ['-y', '-i', d + '/stem_dialogue.wav', '-i', d + '/stem_bg.wav', '-filter_complex', 'amix=inputs=2:normalize=0', out]);
  assert.ok(Math.abs(meanDb(out, 1.5, 2) - origSpeech) < 1.5, 'dialogue + background must match the original loudness');
});

test('5.1 source uses the centre channel as dialogue (clean split)', async () => {
  const id = await app.ingestFixture('clip_51.mkv');
  const st = await runStems(id);
  assert.equal(st.method, 'surround-center');
  const d = app.dir(id);
  assert.ok(meanDb(d + '/stem_dialogue.wav', 1.5, 2) - meanDb(d + '/stem_dialogue.wav', 0, 0.9) > 40);
  assert.ok(meanDb(d + '/stem_bg.wav', 1.5, 2) < -80 + 80 && Math.abs(meanDb(d + '/stem_bg.wav', 1.5, 2) - meanDb(d + '/stem_bg.wav', 0, 0.9)) < 3, 'bg has no speech');
  assert.equal(ffprobeJson(d + '/stem_bg.wav').streams[0].channels, 2);
});

test('mono sources are reported as unseparable (no fake stems)', async () => {
  const id = await app.ingestFixture('clip_mono.mp4');
  const st = await runStems(id);
  assert.equal(st.status, 'unsupported');
  assert.ok(!fs.existsSync(app.dir(id) + '/stem_dialogue.wav'));
});

test('silent clip: stems refuse politely', async () => {
  const id = await app.ingestFixture('clip_silent.mp4');
  const r = await app.api('POST', `/api/projects/${id}/stems`);
  await assert.rejects(app.waitJob(r.data.job), /no audio/i);
});

test('speech-segment detection finds the spoken phrase (cue skeleton for clips without subtitles)', async () => {
  const id = await app.ingestFixture('clip_en.mp4');
  await runStems(id); // music is constant, so speech detection needs the dialogue stem
  const { data } = await app.api('POST', `/api/projects/${id}/speech-segments`, {});
  assert.ok(data.segments.length >= 1, JSON.stringify(data));
  assert.ok(Math.abs(data.segments[0].start - 1.0) < 0.5, 'first segment starts near 1.0s: ' + data.segments[0].start);
});

test('take upload + mic clean-up (denoise, highpass, normalize) keeps length and raises a quiet take', async () => {
  const id = await app.ingestFixture('clip_en.mp4');
  // a quiet, noisy, rumbly "budget mic" take
  const take = app.dir(id) + '/../in.wav';
  spawnSync('ffmpeg', ['-y', '-i', fx('speech_en.wav'), '-f', 'lavfi', '-i', 'anoisesrc=c=white:a=0.01:d=6', '-f', 'lavfi', '-i', 'sine=f=50:d=6', '-filter_complex', '[0]volume=0.08[a];[2]volume=0.05[r];[a][1][r]amix=inputs=3:normalize=0', '-ar', '48000', '-ac', '1', take]);
  const up = await app.api('POST', `/api/projects/${id}/takes/take_test.wav`, fs.readFileSync(take));
  assert.equal(up.status, 201);
  const cl = await app.api('POST', `/api/projects/${id}/takes/take_test.wav/clean`);
  assert.equal(cl.status, 200); assert.equal(cl.data.name, 'take_test_clean.wav');
  const before = meanDb(app.dir(id) + '/takes/take_test.wav'); const after = meanDb(app.dir(id) + '/takes/take_test_clean.wav');
  assert.ok(after > before + 6, `louder after clean-up (${before} → ${after})`);
  const dur = (f) => Number(ffprobeJson(f).format.duration);
  assert.ok(Math.abs(dur(app.dir(id) + '/takes/take_test.wav') - dur(app.dir(id) + '/takes/take_test_clean.wav')) < 0.05);
  assert.ok([400, 404].includes((await app.api('POST', `/api/projects/${id}/takes/..%2f..%2fx.wav`, Buffer.from('x'))).status));
  assert.ok(!fs.existsSync(app.dir(id) + '/../x.wav'));
  assert.equal((await app.api('POST', `/api/projects/${id}/takes/bad.exe`, Buffer.from('x'))).status, 400);
});
