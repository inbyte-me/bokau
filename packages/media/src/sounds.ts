import fs from 'node:fs';
import type { Progress } from '@doblaje/core';
import type { MediaConfig } from './config.ts';
import { probe, runFfmpeg } from './ffmpeg.ts';

/** Longest background track kept (the rest is cut): phones loop it anyway. */
export const MAX_SOUND_SECONDS = 15 * 60;

/**
 * Turn any audio or video file into a background track every phone can play: AAC in .m4a (iOS Safari does
 * not play Ogg/WebM everywhere), stereo, loud and even (it has to cover a voice in the same room).
 * Returns the duration in seconds.
 */
export async function importSound(cfg: MediaConfig, src: string, dest: string, progress: Progress = () => {}): Promise<number> {
  const info = await probe(cfg, src);
  if (!info.hasAudio) throw new Error('this file has no audio');
  const durationSec = Math.min(info.duration || MAX_SOUND_SECONDS, MAX_SOUND_SECONDS);
  const tmp = `${dest}.part.m4a`;
  try {
    await runFfmpeg(
      cfg,
      [
        '-i',
        src,
        '-t',
        String(MAX_SOUND_SECONDS),
        '-vn',
        '-ac',
        '2',
        '-ar',
        '44100',
        '-af',
        'loudnorm=I=-14:TP=-1.5:LRA=11',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        tmp,
      ],
      { durationSec, onProgress: (f) => progress(f, 'converting') },
    );
    fs.renameSync(tmp, dest);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return (await probe(cfg, dest)).duration;
}
