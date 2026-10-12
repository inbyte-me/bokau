import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestApp } from '@doblaje/testkit';
import { ffprobeJson, fx, startApp } from '@doblaje/testkit';

let app: TestApp;
test.before(async () => {
  app = await startApp();
});
test.after(async () => {
  await app.close();
});

/** upload a recording the way the browser does: start, N appended chunks, finish -> ingest */
async function recordFixture(name, { chunks = 5 } = {}) {
  const { data: proj } = await app.api('POST', '/api/projects', { name: 'My Podcast', mode: 'podcast' });
  assert.equal(proj.mode, 'podcast');
  const buf = fs.readFileSync(fx(name));
  const step = Math.ceil(buf.length / chunks);
  await app.api('POST', `/api/projects/${proj.id}/recording/start`, {});
  for (let i = 0; i < chunks; i++) {
    const r = await app.api('POST', `/api/projects/${proj.id}/recording/append`, buf.subarray(i * step, (i + 1) * step));
    assert.equal(r.status, 200);
  }
  const fin = await app.api('POST', `/api/projects/${proj.id}/recording/finish`, {});
  assert.equal(fin.status, 202);
  await app.waitJob(fin.data.job);
  return proj.id;
}
const loud = (file) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const t = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  return { i: Number(/I:\s+(-?[\d.]+) LUFS/.exec(t)?.[1]), tp: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(t)?.[1]) };
};
const exp = async (id, o) => {
  const r = await app.api('POST', `/api/projects/${id}/podcast-export`, o);
  assert.equal(r.status, 202);
  return (await app.waitJob(r.data.job)).result;
};
const out = (id, res, f) => path.join(app.dir(id), 'exports', res.dir, f);

test('streamed recording (no duration header) is repaired and ingested: duration, proxy, audio', async () => {
  const id = await recordFixture('rec_stream.webm');
  const { data: p } = await app.api('GET', `/api/projects/${id}`);
  assert.equal(p.media.ready, true);
  assert.ok(Math.abs(p.media.duration - 8) < 0.4, `duration ${p.media.duration}`);
  assert.equal(p.media.hasVideo, true);
  assert.equal(p.media.hasAudio, true);
  assert.ok(fs.existsSync(`${app.dir(id)}/proxy.mp4`) && fs.existsSync(`${app.dir(id)}/audio_orig.wav`));
});

test('audio-only recording works too (black proxy, audio extracted)', async () => {
  const id = await recordFixture('rec_stream_audio.webm', { chunks: 3 });
  const { data: p } = await app.api('GET', `/api/projects/${id}`);
  assert.equal(p.media.hasVideo, false);
  assert.equal(p.media.hasAudio, true);
  assert.ok(Math.abs(p.media.duration - 8) < 0.4);
  const r = await app.api('POST', `/api/projects/${id}/podcast-export`, { format: 'mp4' });
  await assert.rejects(app.waitJob(r.data.job), /audio-only/);
});

test('recording endpoints reject empty/unknown projects and tiny uploads', async () => {
  const { data: proj } = await app.api('POST', '/api/projects', { name: 'x', mode: 'podcast' });
  assert.equal((await app.api('POST', `/api/projects/${proj.id}/recording/finish`, {})).status, 400);
  assert.equal((await app.api('POST', `/api/projects/nope1234/recording/append`, Buffer.from('x'))).status, 404);
});

test('MP3 export normalises to -16 LUFS (two-pass), true peak under -1 dBFS, with chapters file and transcript', async () => {
  const id = await recordFixture('rec_stream.webm');
  const { data: p } = await app.api('GET', `/api/projects/${id}`);
  p.cues = [
    { id: 'a', start: 1, end: 3, text: 'Hello there.' },
    { id: 'b', start: 3.5, end: 6, text: 'Coffee please.' },
  ];
  await app.api('PUT', `/api/projects/${id}`, p);
  const before = loud(`${app.dir(id)}/audio_orig.wav`);
  const res = await exp(id, {
    format: 'mp3',
    loudnorm: true,
    clean: { rumble: true, denoise: false, compress: true },
    chapters: [
      { t: 0, title: 'Intro' },
      { t: 4, title: 'Coffee' },
    ],
  });
  const f = out(id, res, 'My_Podcast.mp3');
  const info = ffprobeJson(f);
  assert.equal(info.streams[0].codec_name, 'mp3');
  assert.ok(Math.abs(Number(info.format.duration) - 8) < 0.5);
  const l = loud(f);
  assert.ok(Math.abs(l.i + 16) < 1.0, `integrated ${l.i} LUFS (was ${before.i})`);
  assert.ok(l.tp <= -0.9, `true peak ${l.tp}`);
  assert.ok(Math.abs(res.loudness.integrated + 16) < 1.0, `server reports the measured loudness: ${JSON.stringify(res.loudness)}`);
  assert.deepEqual(res.files.sort(), ['My_Podcast.mp3', 'My_Podcast.srt', 'My_Podcast_chapters.txt', 'My_Podcast_transcript.txt'].sort());
  assert.equal(fs.readFileSync(out(id, res, 'My_Podcast_chapters.txt'), 'utf8'), '00:00 Intro\n00:04 Coffee\n');
  assert.match(fs.readFileSync(out(id, res, 'My_Podcast.srt'), 'utf8'), /Hello there\./);
});

test('M4A carries real chapter marks; trim cuts the file and shifts chapters/cues', async () => {
  const id = await recordFixture('rec_stream.webm');
  const { data: p } = await app.api('GET', `/api/projects/${id}`);
  p.cues = [{ id: 'a', start: 3.2, end: 5, text: 'Inside the trim.' }];
  await app.api('PUT', `/api/projects/${id}`, p);
  const res = await exp(id, {
    format: 'm4a',
    loudnorm: false,
    trim: { start: 2, end: 6 },
    chapters: [
      { t: 0, title: 'Before trim' },
      { t: 3, title: 'Middle' },
      { t: 7, title: 'After trim' },
    ],
  });
  const f = out(id, res, 'My_Podcast.m4a');
  const info = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_chapters', '-show_format', f], { encoding: 'utf8' }).stdout);
  assert.ok(Math.abs(Number(info.format.duration) - 4) < 0.3, `trimmed to 4 s: ${info.format.duration}`);
  assert.deepEqual(
    info.chapters.map((c) => c.tags.title),
    ['Start', 'Middle'],
    'chapters outside the trim are dropped; a 0:00 chapter is added',
  );
  assert.ok(
    Math.abs(Number(info.chapters[0].start_time)) < 0.05 && Math.abs(Number(info.chapters[1].start_time) - 1) < 0.05,
    `chapter shifted by the trim start: ${JSON.stringify(info.chapters.map((c) => c.start_time))}`,
  );
  assert.match(fs.readFileSync(out(id, res, 'My_Podcast.srt'), 'utf8'), /00:00:01,200 --> 00:00:03,000/, 'cue shifted into the trimmed timeline');
});

test('voice clean-up: denoise + rumble filter reduce noise floor of a hissy, rumbly voice', async () => {
  const id = await recordFixture('rec_stream.webm');
  const raw = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      fx('speech_en.wav'),
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=c=white:a=0.02:d=7',
      '-f',
      'lavfi',
      '-i',
      'sine=f=45:d=7',
      '-filter_complex',
      '[0]volume=0.25[a];[2]volume=0.15[r];[a][1][r]amix=inputs=3:normalize=0',
      '-ar',
      '48000',
      '-c:a',
      'libopus',
      '-f',
      'webm',
      '-',
    ],
    { maxBuffer: 1 << 26 },
  ).stdout;
  fs.writeFileSync(`${app.dir(id)}/source.webm`, raw);
  const noisy = await exp(id, { format: 'wav', loudnorm: false, clean: { rumble: false, denoise: false, compress: false } });
  const clean = await exp(id, { format: 'wav', loudnorm: false, clean: { rumble: true, denoise: true, compress: false } });
  const lowBand = (f) => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', f, '-af', 'lowpass=f=70,volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    return Number(/mean_volume: (-?[\d.]+) dB/.exec(r.stderr)?.[1]);
  };
  assert.ok(lowBand(out(id, clean, 'My_Podcast.wav')) < lowBand(out(id, noisy, 'My_Podcast.wav')) - 8, 'rumble removed');
  const hiss = (f) => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-ss', '6.2', '-t', '0.7', '-i', f, '-af', 'volumedetect', '-f', 'null', '-'], {
      encoding: 'utf8',
    });
    return Number(/mean_volume: (-?[\d.]+) dB/.exec(r.stderr)?.[1]);
  };
  assert.ok(hiss(out(id, clean, 'My_Podcast.wav')) < hiss(out(id, noisy, 'My_Podcast.wav')) - 3, 'hiss in the pauses reduced');
});

test('video exports: MP4 re-encode and WebM stream copy keep picture, with processed audio', async () => {
  const id = await recordFixture('rec_stream.webm');
  const mp4 = await exp(id, { format: 'mp4', loudnorm: true });
  const i1 = ffprobeJson(out(id, mp4, 'My_Podcast.mp4'));
  assert.equal(i1.streams.find((s) => s.codec_type === 'video').codec_name, 'h264');
  assert.equal(i1.streams.find((s) => s.codec_type === 'audio').codec_name, 'aac');
  const webm = await exp(id, { format: 'webm', loudnorm: false });
  const i2 = ffprobeJson(out(id, webm, 'My_Podcast.webm'));
  assert.equal(i2.streams.find((s) => s.codec_type === 'video').codec_name, 'vp8', 'video stream copied, not re-encoded');
  assert.equal(i2.streams.find((s) => s.codec_type === 'audio').codec_name, 'opus');
});
