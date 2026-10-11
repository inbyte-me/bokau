import fs from 'node:fs';
import path from 'node:path';
import { exec, runFfmpeg, probe } from './ffmpeg.js';

/**
 * Ingest pipeline: source file -> browser-friendly proxy video, 48k stereo WAV for waveform/mixing,
 * 16k mono WAV for speech-to-text, poster and thumbnail sprite.
 * Stream-copy export later uses the ORIGINAL file, the proxy is only for editing.
 */
export async function ingest(cfg, projects, id, srcFile, job) {
  const dir = projects.dir(id);
  const p = projects.get(id);
  const set = (progress, message) => { if (job) { job.progress = progress; job.message = message; } };

  set(0.02, 'probe');
  let info = await probe(cfg, srcFile);
  if (!info.duration && (info.hasVideo || info.hasAudio)) { // MediaRecorder output has no duration/cues: remux once so the file becomes seekable
    set(0.03, 'repair');
    const fixed = srcFile + '.fixed' + path.extname(srcFile);
    await runFfmpeg(cfg, ['-fflags', '+genpts', '-i', srcFile, '-c', 'copy', fixed]);
    fs.renameSync(fixed, srcFile);
    info = await probe(cfg, srcFile);
    if (!info.duration) { // last resort: decode once and read the clock
      const { stderr } = await exec(cfg.ffmpeg, ['-hide_banner', '-nostdin', '-i', srcFile, '-f', 'null', '-']);
      const m = [...stderr.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)].pop();
      if (m) info.duration = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
  }
  if (!info.duration || (!info.hasVideo && !info.hasAudio)) throw new Error('No playable audio/video found in this file');
  const duration = info.duration;

  // 1. proxy video (edit-friendly: all-intra-ish GOP for smooth scrubbing, no audio)
  const proxy = path.join(dir, 'proxy.mp4');
  if (info.hasVideo) {
    set(0.05, 'video');
    const scale = info.height > 720 ? ['-vf', "scale=-2:720,format=yuv420p"] : ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p'];
    await runFfmpeg(cfg, ['-i', srcFile, '-map', '0:v:0', '-an', ...scale, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
      '-g', String(Math.max(2, Math.round(info.fps || 25) / 2 | 0)), '-sc_threshold', '0', '-movflags', '+faststart', proxy],
    { durationSec: duration, onProgress: (f) => set(0.05 + f * 0.5, 'video') });
  } else {
    set(0.05, 'video');
    await runFfmpeg(cfg, ['-f', 'lavfi', '-i', `color=c=0x15171c:s=1280x720:r=25:d=${duration}`, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', proxy]);
  }

  // 2. audio
  set(0.58, 'audio');
  const audioFile = path.join(dir, 'audio_orig.wav');
  const stt = path.join(dir, 'audio_16k.wav');
  if (info.hasAudio) {
    await runFfmpeg(cfg, ['-i', srcFile, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', audioFile]);
    await runFfmpeg(cfg, ['-i', audioFile, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', stt]);
  } else {
    await runFfmpeg(cfg, ['-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`, '-t', String(duration), '-c:a', 'pcm_s16le', audioFile]);
  }

  // 3. poster + thumbnail strip
  set(0.8, 'thumbnails');
  const vsrc = proxy;
  await runFfmpeg(cfg, ['-ss', String(Math.min(1, duration / 4)), '-i', vsrc, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', path.join(dir, 'poster.jpg')]);
  const count = Math.max(1, Math.min(240, Math.ceil(duration / 1))); // aim ~1 thumb/sec, cap 240
  const interval = duration / count;
  const th = 54; const tw = Math.round(th * ((info.width || 16) / (info.height || 9)) / 2) * 2 || 96;
  // tile into rows of <=20 columns to keep sprite dimensions sane
  const cols = Math.min(20, count); const rows = Math.ceil(count / cols);
  await runFfmpeg(cfg, ['-i', vsrc, '-vf', `fps=1/${interval},scale=${tw}:${th},tile=${cols}x${rows}`, '-frames:v', '1', '-q:v', '5', path.join(dir, 'thumbs.jpg')]);

  const media = { ...info, ready: true, proxy: 'proxy.mp4', audio: 'audio_orig.wav', audioStt: info.hasAudio ? 'audio_16k.wav' : null,
    sourceFile: path.basename(srcFile), thumbs: { file: 'thumbs.jpg', count, interval, w: tw, h: th, cols, rows }, ingestedAt: new Date().toISOString() };
  const fresh = projects.get(id);
  fresh.media = media;
  projects.save(fresh);
  set(1, 'done');
  return media;
}
