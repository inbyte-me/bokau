import fs from 'node:fs';
import path from 'node:path';
import type { Media, ProbeInfo, Progress, ProjectRepository, Thumbs } from '@doblaje/core';
import type { MediaConfig } from './config.ts';
import { exec, probe, runFfmpeg } from './ffmpeg.ts';

const noop: Progress = () => {};

/**
 * Ingest pipeline: source file -> browser-friendly proxy video, 48k stereo WAV for waveform/mixing,
 * 16k mono WAV for speech-to-text, poster and thumbnail sprite.
 * Stream-copy export later uses the ORIGINAL file; the proxy is only for editing.
 */
export async function ingest(cfg: MediaConfig, projects: ProjectRepository, id: string, srcFile: string, set: Progress = noop): Promise<Media> {
  const dir = projects.dir(id);
  projects.get(id); // 404 early

  set(0.02, 'probe');
  let info = await probe(cfg, srcFile);
  if (!info.duration && (info.hasVideo || info.hasAudio)) {
    // MediaRecorder output has no duration/cues: remux once so the file becomes seekable
    set(0.03, 'repair');
    const fixed = `${srcFile}.fixed${path.extname(srcFile)}`;
    await runFfmpeg(cfg, ['-fflags', '+genpts', '-i', srcFile, '-c', 'copy', fixed]);
    fs.renameSync(fixed, srcFile);
    info = await probe(cfg, srcFile);
    if (!info.duration) {
      // last resort: decode once and read the clock
      const { stderr } = await exec(cfg.ffmpeg, ['-hide_banner', '-nostdin', '-i', srcFile, '-f', 'null', '-']);
      const m = [...stderr.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)].pop();
      if (m) info.duration = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
  }
  if (!info.duration || (!info.hasVideo && !info.hasAudio)) throw new Error('No playable audio/video found in this file');
  const duration = info.duration;

  // 1. proxy video (edit-friendly: short GOP for smooth scrubbing, no audio)
  const proxy = path.join(dir, 'proxy.mp4');
  set(0.05, 'video');
  if (info.hasVideo) {
    await runFfmpeg(cfg, ['-i', srcFile, '-map', '0:v:0', '-an', ...proxyEncoding(info), proxy], {
      durationSec: duration,
      onProgress: (f) => set(0.05 + f * 0.5, 'video'),
    });
  } else {
    await runFfmpeg(cfg, [
      '-f',
      'lavfi',
      '-i',
      `color=c=0x15171c:s=1280x720:r=25:d=${duration}`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      proxy,
    ]);
  }

  // 2. audio
  set(0.58, 'audio');
  const audioFile = path.join(dir, 'audio_orig.wav');
  const stt = path.join(dir, 'audio_16k.wav');
  if (info.hasAudio) {
    await runFfmpeg(cfg, ['-i', srcFile, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', audioFile]);
    await runFfmpeg(cfg, ['-i', audioFile, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', stt]);
  } else {
    await runFfmpeg(cfg, ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(duration), '-c:a', 'pcm_s16le', audioFile]);
  }

  // 3. poster + thumbnail strip
  set(0.8, 'thumbnails');
  const thumbs = await posterAndThumbs(cfg, dir, duration, info);

  const media: Media = {
    ...info,
    ready: true,
    proxy: 'proxy.mp4',
    audio: 'audio_orig.wav',
    audioStt: info.hasAudio ? 'audio_16k.wav' : null,
    sourceFile: path.basename(srcFile),
    thumbs,
    ingestedAt: new Date().toISOString(),
  };
  const fresh = projects.get(id);
  fresh.media = media;
  projects.save(fresh);
  set(1, 'done');
  return media;
}

/** The proxy's encoding (edit-friendly: at most 720p, short GOP for smooth scrubbing); the caller maps the video. */
export function proxyEncoding(info: Pick<ProbeInfo, 'height' | 'fps'>): string[] {
  const scale = info.height > 720 ? ['-vf', 'scale=-2:720,format=yuv420p'] : ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p'];
  return [...scale, ...proxyCodec(info)];
}

/** The proxy's codec settings alone (for a picture already at the proxy's size). */
export function proxyCodec(info: Pick<ProbeInfo, 'fps'>): string[] {
  const gop = String(Math.max(2, Math.trunc(Math.round(info.fps || 25) / 2)));
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-g', gop, '-sc_threshold', '0', '-movflags', '+faststart'];
}

/** Poster (about a second in) and thumbnail strip (~1 thumb/s, at most 240, rows of <= 20 to keep the sprite sane), from the proxy. */
export async function posterAndThumbs(cfg: MediaConfig, dir: string, duration: number, info: Pick<ProbeInfo, 'width' | 'height'>): Promise<Thumbs> {
  const proxy = path.join(dir, 'proxy.mp4');
  await runFfmpeg(cfg, [
    '-ss',
    String(Math.min(1, duration / 4)),
    '-i',
    proxy,
    '-frames:v',
    '1',
    '-vf',
    'scale=480:-2',
    '-q:v',
    '4',
    path.join(dir, 'poster.jpg'),
  ]);
  const count = Math.max(1, Math.min(240, Math.ceil(duration)));
  const interval = duration / count;
  const th = 54;
  const tw = Math.round((th * ((info.width || 16) / (info.height || 9))) / 2) * 2 || 96;
  const cols = Math.min(20, count);
  const rows = Math.ceil(count / cols);
  await runFfmpeg(cfg, [
    '-i',
    proxy,
    '-vf',
    `fps=1/${interval},scale=${tw}:${th},tile=${cols}x${rows}`,
    '-frames:v',
    '1',
    '-q:v',
    '5',
    path.join(dir, 'thumbs.jpg'),
  ]);
  return { file: 'thumbs.jpg', count, interval, w: tw, h: th, cols, rows };
}
