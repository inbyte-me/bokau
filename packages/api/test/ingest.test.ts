import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('health + system', async () => {
  const h = await app.api('GET', '/api/health');
  assert.equal(h.status, 200);
  assert.match(h.data.ffmpeg, /ffmpeg version/);
  const s = await app.api('GET', '/api/system');
  assert.equal(s.data.localOnly, true);
  assert.equal(s.data.ai.configured, true);
  assert.ok(!JSON.stringify(s.data).includes('test-key-not-real'), 'API key must never be exposed');
});

test('rejects foreign Host header (DNS rebinding) and cross-origin writes', async () => {
  // fetch() cannot override the Host header, so use raw http
  const http = await import('node:http');
  const status = await new Promise((resolve) => {
    const req = http.request(`${app.base}/api/projects`, { headers: { host: 'evil.example.com' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.end();
  });
  assert.equal(status, 403);
  const x = await app.api('POST', '/api/projects', { name: 'x' }, { origin: 'http://evil.example.com' });
  assert.equal(x.status, 403);
});

test('ingest mp4: proxy, audio, stt audio, poster, thumbs, metadata', async () => {
  const id = await app.ingestFixture('clip_en.mp4');
  const { data: p } = await app.api('GET', `/api/projects/${id}`);
  assert.equal(p.media.ready, true);
  assert.ok(Math.abs(p.media.duration - 12) < 0.3, `duration ${p.media.duration}`);
  assert.equal(p.media.width, 640);
  assert.equal(p.media.height, 360);
  assert.equal(p.media.fps, 25);
  assert.equal(p.media.hasAudio, true);
  assert.equal(p.media.vcodec, 'h264');
  const proxy = ffprobeJson(`${app.dir(id)}/proxy.mp4`);
  assert.equal(proxy.streams.filter((s) => s.codec_type === 'audio').length, 0, 'proxy is video only');
  const wav = ffprobeJson(`${app.dir(id)}/audio_orig.wav`).streams[0];
  assert.equal(wav.sample_rate, '48000');
  assert.equal(wav.channels, 2);
  assert.equal(ffprobeJson(`${app.dir(id)}/audio_16k.wav`).streams[0].sample_rate, '16000');
  assert.ok(fs.statSync(`${app.dir(id)}/poster.jpg`).size > 1000);
  assert.ok(p.media.thumbs.count >= 10);
});

test('media serving supports Range (needed for <video> seeking) and blocks traversal', async () => {
  const id = await app.ingestFixture('clip_en.mp4');
  const full = await fetch(`${app.base}/media/${id}/proxy.mp4`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  const size = Number(full.headers.get('content-length'));
  const part = await fetch(`${app.base}/media/${id}/proxy.mp4`, { headers: { range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 100-199/${size}`);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  const tail = await fetch(`${app.base}/media/${id}/proxy.mp4`, { headers: { range: 'bytes=-50' } });
  assert.equal(tail.status, 206);
  assert.equal((await tail.arrayBuffer()).byteLength, 50);
  assert.equal((await fetch(`${app.base}/media/${id}/project.json`)).status, 404);
  assert.equal((await fetch(`${app.base}/media/${id}/..%2f..%2fetc/passwd`)).status, 404);
  assert.equal((await fetch(`${app.base}/vendor/ort/..%2f..%2fpackage.json`)).status, 403);
});

test('ingest via upload (raw body) + webm + silent + portrait + 5.1', async () => {
  for (const [name, check] of [
    ['clip_webm.webm', (m) => m.vcodec === 'vp8' && m.hasAudio],
    ['clip_silent.mp4', (m) => m.hasVideo && !m.hasAudio],
    ['clip_tall.mp4', (m) => m.height > m.width],
    ['clip_51.mkv', (m) => m.channels === 6],
    ['clip_mov.mov', (m) => m.hasVideo && m.hasAudio && m.vcodec === 'h264'],
  ] as [string, (m: any) => boolean][]) {
    const { data: proj } = await app.api('POST', '/api/projects', { name, mode: 'pro' });
    const r = await app.api('POST', `/api/projects/${proj.id}/source`, fs.readFileSync(fx(name)), { 'x-filename': name });
    assert.equal(r.status, 202, name);
    await app.waitJob(r.data.job);
    const { data: p } = await app.api('GET', `/api/projects/${proj.id}`);
    assert.ok(check(p.media), `${name} ${JSON.stringify(p.media)}`);
    assert.ok(fs.existsSync(`${app.dir(proj.id)}/proxy.mp4`));
    assert.ok(fs.existsSync(`${app.dir(proj.id)}/audio_orig.wav`), 'silent clips still get a (silent) timeline audio file');
  }
});

test('upload validation', async () => {
  const { data: proj } = await app.api('POST', '/api/projects', { name: 'bad' });
  const r = await app.api('POST', `/api/projects/${proj.id}/source`, Buffer.from('nope'), { 'x-filename': 'evil.exe' });
  assert.equal(r.status, 415);
  const { data: p2 } = await app.api('POST', '/api/projects', { name: 'junk' });
  const j = await app.api('POST', `/api/projects/${p2.id}/source`, Buffer.from('not a video at all'), { 'x-filename': 'junk.mp4' });
  await assert.rejects(app.waitJob(j.data.job), /job failed/);
});

test('project CRUD: autosave keeps server-owned media, list shows it, delete removes', async () => {
  const id = await app.ingestFixture('clip_en.mp4');
  const { data: p } = await app.api('GET', `/api/projects/${id}`);
  p.cues = [{ id: 'c1', start: 1, end: 2, text: 'hi' }];
  p.media = { hacked: true };
  p.name = 'Renamed';
  const u = await app.api('PUT', `/api/projects/${id}`, p);
  assert.equal(u.status, 200);
  assert.equal(u.data.name, 'Renamed');
  assert.equal(u.data.cues.length, 1);
  assert.equal(u.data.media.ready, true, 'client cannot overwrite media info');
  const list = await app.api('GET', '/api/projects');
  assert.ok(list.data.find((x) => x.id === id && x.cues === 1 && x.ready));
  assert.equal((await app.api('DELETE', `/api/projects/${id}`)).status, 200);
  assert.equal((await app.api('GET', `/api/projects/${id}`)).status, 404);
  assert.equal((await app.api('GET', '/api/projects/..%2f..')).status, 400);
});

test('subtitle import (srt/vtt)', async () => {
  const { data: proj } = await app.api('POST', '/api/projects', { name: 's' });
  const srt = await app.api('POST', `/api/projects/${proj.id}/import-subs`, fs.readFileSync(fx('sample.srt')));
  assert.equal(srt.data.cues.length, 3);
  assert.equal(srt.data.cues[1].character, 'JOHN');
  assert.equal(srt.data.cues[2].text, 'Do you have any cheese?');
  const vtt = await app.api('POST', `/api/projects/${proj.id}/import-subs`, fs.readFileSync(fx('sample.vtt')));
  assert.equal(vtt.data.cues.length, 2);
  assert.equal((await app.api('POST', `/api/projects/${proj.id}/import-subs`, Buffer.from('garbage'))).status, 400);
});
