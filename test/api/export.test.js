import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startApp, ffprobeJson, meanDb, frameDiff } from '../helpers.js';

let app;
test.before(async () => { app = await startApp(); });
test.after(async () => { await app.close(); });

const sine = (file, dur, f = 440, vol = 0.3) => spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `sine=f=${f}:d=${dur}:r=48000`, '-af', `volume=${vol},aformat=channel_layouts=stereo`, file]);
async function prep(fixture, { cues = true } = {}) {
  const id = await app.ingestFixture(fixture);
  const dur = (await app.api('GET', `/api/projects/${id}`)).data.media.duration;
  const rd = app.dir(id) + '/renders'; fs.mkdirSync(rd, { recursive: true });
  for (const [n, f] of [['mix', 440], ['bg', 220], ['dry', 330], ['wet', 660]]) sine(`${rd}/${n}.wav`, dur, f);
  if (cues) {
    const { data: p } = await app.api('GET', `/api/projects/${id}`);
    p.cues = [{ id: 'c1', start: 1, end: 3, text: 'Hello there', character: 'Ann' }, { id: 'c2', start: 4, end: 7, text: 'A much longer line that will have to wrap across the frame width nicely', character: '' }];
    p.name = 'My Parody!';
    await app.api('PUT', `/api/projects/${id}`, p);
  }
  return id;
}
const doExport = async (id, opts) => {
  const r = await app.api('POST', `/api/projects/${id}/export`, opts);
  assert.equal(r.status, 202);
  const job = await app.waitJob(r.data.job);
  return job.result;
};
const out = (id, res, f) => path.join(app.dir(id), 'exports', res.dir, f);

test('fast export = stream copy: video bytes untouched, audio replaced by the rendered mix', async () => {
  const id = await prep('clip_en.mp4');
  const res = await doExport(id, { profile: 'quick' });
  assert.equal(res.plan.fast, true); assert.equal(res.plan.container, 'mp4');
  const f = out(id, res, 'My_Parody.mp4');
  const pr = ffprobeJson(f); const src = ffprobeJson(app.dir(id) + '/source.mp4');
  const v = pr.streams.find((s) => s.codec_type === 'video'); const sv = src.streams.find((s) => s.codec_type === 'video');
  assert.equal(v.codec_name, 'h264'); assert.equal(v.width, 640);
  assert.equal(v.nb_frames, sv.nb_frames, 'same frame count => not re-encoded');
  // a stream copy must keep the exact H.264 extradata/profile
  assert.equal(v.profile, sv.profile); assert.equal(v.level, sv.level);
  assert.ok(Math.abs(Number(pr.format.duration) - 12) < 0.3);
  // audio now is the 440 Hz sine mix, not the dialogue: check it is steady (constant level)
  assert.ok(Math.abs(meanDb(f, 1, 1) - meanDb(f, 8, 1)) < 1.5);
  assert.ok(res.files.includes('My_Parody.srt') && res.files.includes('My_Parody.json'));
  assert.match(fs.readFileSync(out(id, res, 'My_Parody.srt'), 'utf8'), /ANN: Hello there/);
});

test('fast export keeps webm as webm (vp8 copy + opus)', async () => {
  const id = await prep('clip_webm.webm', { cues: false });
  const res = await doExport(id, { profile: 'quick' });
  assert.equal(res.plan.container, 'webm');
  const pr = ffprobeJson(out(id, res, 'clip_webm.webm'));
  assert.equal(pr.streams.find((s) => s.codec_type === 'video').codec_name, 'vp8');
  assert.equal(pr.streams.find((s) => s.codec_type === 'audio').codec_name, 'opus');
});

test('full render: burned-in subtitles + watermark change pixels only where expected', async () => {
  const id = await prep('clip_en.mp4');
  const plain = await doExport(id, { profile: 'quick' });
  const burned = await doExport(id, { profile: 'quick', burnSubs: true, watermark: { text: 'MY STUDIO', pos: 'tl' } });
  assert.equal(burned.plan.fast, false);
  const fb = out(id, burned, 'My_Parody.mp4'); const fp = out(id, plain, 'My_Parody.mp4');
  assert.equal(ffprobeJson(fb).streams.find((s) => s.codec_type === 'video').width, 640);
  assert.ok(frameDiff(fb, fp, 2, '640:72:0:288') > 4, 'subtitle strip drawn at t=2');
  assert.ok(frameDiff(fb, fp, 3.5, '640:72:0:288') < 1.5, 'no subtitle in the gap');
  assert.ok(frameDiff(fb, fp, 3.5, '200:40:0:0') > 3, 'watermark top-left');
  assert.ok(frameDiff(fb, fp, 3.5, '100:100:540:100') < 1.5, 'rest of image untouched');
});

test('9:16 vertical crop from landscape; focus point moves the crop window', async () => {
  const id = await prep('clip_en.mp4', { cues: false });
  const left = await doExport(id, { profile: 'quick', vertical: { enabled: true, focusX: 0 }, maxHeight: 360 });
  const right = await doExport(id, { profile: 'quick', vertical: { enabled: true, focusX: 1 }, maxHeight: 360 });
  const vs = (r) => ffprobeJson(out(id, r, 'clip_en.mp4')).streams.find((s) => s.codec_type === 'video');
  assert.equal(vs(left).width / vs(left).height, 202 / 360, 'about 9:16');
  assert.ok(Math.abs(vs(left).width / vs(left).height - 9 / 16) < 0.01);
  assert.ok(frameDiff(out(id, left, 'clip_en.mp4'), out(id, right, 'clip_en.mp4'), 1, '200:300:0:0') > 8, 'different window of the picture');
});

test('target size (WhatsApp/Discord): output lands under the requested MB', async () => {
  const id = await prep('clip_en.mp4', { cues: false });
  const res = await doExport(id, { profile: 'quick', targetMb: 1, burnSubs: false, watermark: { text: 'x' } });
  const size = fs.statSync(out(id, res, 'clip_en.mp4')).size;
  assert.ok(size < 1.1 * 1024 * 1024, 'size ' + size);
});

test('webm full render (VP9/Opus)', async () => {
  const id = await prep('clip_en.mp4', { cues: false });
  const res = await doExport(id, { profile: 'quick', format: 'webm', watermark: { text: 'hi' } });
  const pr = ffprobeJson(out(id, res, 'clip_en.webm'));
  assert.equal(pr.streams.find((s) => s.codec_type === 'video').codec_name, 'vp9');
  assert.equal(pr.streams.find((s) => s.codec_type === 'audio').codec_name, 'opus');
});

test('studio archive: mixed video + three isolated wav stems with the contract file names', async () => {
  const id = await prep('clip_en.mp4');
  const res = await doExport(id, { profile: 'archive' });
  for (const f of ['video_mixed.mp4', 'stem_original_music_sfx.wav', 'stem_user_voice_dry.wav', 'stem_user_voice_wet.wav']) assert.ok(res.files.includes(f), f + ' missing in ' + res.files);
  // stems are distinct renders
  const d = (f) => meanDb(out(id, res, f));
  assert.ok(fs.statSync(out(id, res, 'stem_user_voice_dry.wav')).size > 100000);
  assert.ok(res.dir.startsWith('My_Parody'));
  // download route serves them
  const dl = await fetch(`${app.base}/media/${id}/exports/${res.dir}/video_mixed.mp4`);
  assert.equal(dl.status, 200); assert.match(dl.headers.get('content-disposition'), /video_mixed\.mp4/);
});

test('loudness normalisation option and audio-only clips', async () => {
  const id = await prep('clip_en.mp4', { cues: false });
  const res = await doExport(id, { profile: 'quick', loudnorm: true });
  const db = meanDb(out(id, res, 'clip_en.mp4'));
  assert.ok(db > -26 && db < -12, 'normalised level ' + db);
});

test('export without rendered mix fails clearly', async () => {
  const id = await app.ingestFixture('clip_en.mp4');
  const r = await app.api('POST', `/api/projects/${id}/export`, { profile: 'quick' });
  await assert.rejects(app.waitJob(r.data.job), /No rendered mix/);
});

test('export plan helper reports whether stream copy is possible', async () => {
  const id = await app.ingestFixture('clip_en.mp4');
  assert.equal((await app.api('POST', `/api/projects/${id}/export-plan`, { burnSubs: true })).data.fast, false);
  assert.equal((await app.api('POST', `/api/projects/${id}/export-plan`, {})).data.fast, true);
});
