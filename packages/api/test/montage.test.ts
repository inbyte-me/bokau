import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleMedia } from '@doblaje/media';
import type { TestApp } from '@doblaje/testkit';
import { ffprobeJson, startApp } from '@doblaje/testkit';

let app: TestApp;
test.before(async () => {
  app = await startApp();
});
test.after(async () => {
  await app.close();
});

test('a montage joins stretches of the clip and black gaps; every file follows the picture', async () => {
  const id = await app.ingestFixture('clip_en.mp4');
  const media = (await app.api('GET', `/api/projects/${id}`)).data.media;
  const dir = app.dir(id);
  const parts = [{ gap: 2 }, { start: 1, end: 4 }, { gap: 0.5 }, { start: 8, end: 10.5 }, { gap: 3 }];
  const out = await assembleMedia({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', toolsDir: '' }, dir, media, parts);
  const want = 2 + 3 + 0.5 + 2.5 + 3;
  assert.ok(Math.abs(out.duration - want) < 0.2, `duration ${out.duration}, wanted ${want}`);
  for (const file of ['source.mp4', 'proxy.mp4', 'audio_orig.wav', 'audio_16k.wav']) {
    const d = Number(ffprobeJson(`${dir}/${file}`).format.duration);
    assert.ok(Math.abs(d - want) < 0.2, `${file} lasts ${d}, wanted ${want}`);
  }
  assert.equal(ffprobeJson(`${dir}/proxy.mp4`).streams.filter((s) => s.codec_type === 'audio').length, 0, 'the proxy stays picture only');
  const source = ffprobeJson(`${dir}/source.mp4`).streams;
  assert.equal(source.find((s) => s.codec_type === 'video')?.width, media.width);
  assert.ok(source.some((s) => s.codec_type === 'audio'));
  // the first two seconds are black and silent
  const { meanDb } = await import('@doblaje/testkit');
  assert.ok(meanDb(`${dir}/audio_orig.wav`, 0, 1.5) < -80, 'the opening gap is silent');
  assert.ok(meanDb(`${dir}/audio_orig.wav`, 2.2, 2.5) > -60, 'then the clip speaks');
});
