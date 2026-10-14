import fs from 'node:fs';
import path from 'node:path';
import { isGap, type Media, type MediaPart, type Progress, type TimeRange } from '@doblaje/core';
import type { MediaConfig } from './config.ts';
import { probe, runFfmpeg } from './ffmpeg.ts';
import { posterAndThumbs, proxyCodec, proxyEncoding } from './ingest.ts';

const noop: Progress = () => {};
/** Working audio that follows the picture: cut the same way when present. */
const AUDIO = ['audio_orig.wav', 'audio_16k.wav', 'stem_dialogue.wav', 'stem_bg.wav'];

/** What a rebuilt file is for: the export source (video and sound, high quality), the proxy (picture), working sound. */
type Kind = 'source' | 'proxy' | 'audio';
/** Writes `out` from `input`, for the kind of file it is. */
type Make = (input: string, out: string, kind: Kind, onProgress?: (f: number) => void) => Promise<void>;

/**
 * Every file that follows the picture is made again from its own file, written aside and then renamed over the old one
 * (so media hard-linked from a library clip is left untouched); poster and thumbnails are made again. `length` is the
 * new duration. Returns the new media; the caller saves it.
 */
async function rebuild(cfg: MediaConfig, dir: string, media: Media, length: number, make: Make, set: Progress): Promise<Media> {
  const replace = (tmp: string, name: string) => fs.renameSync(tmp, path.join(dir, name));

  set(0.05, 'source');
  const src = path.join(dir, media.sourceFile);
  const sourceFile = media.hasVideo ? 'source.mp4' : 'source.m4a';
  const srcTmp = path.join(dir, `cut.${sourceFile}`);
  await make(src, srcTmp, 'source', (f) => set(0.05 + f * 0.6, 'source'));
  if (media.sourceFile !== sourceFile) fs.rmSync(src, { force: true });
  replace(srcTmp, sourceFile);

  set(0.7, 'proxy');
  const proxyTmp = path.join(dir, 'cut.proxy.mp4');
  await make(path.join(dir, media.proxy), proxyTmp, 'proxy');
  replace(proxyTmp, 'proxy.mp4');

  set(0.85, 'audio');
  for (const name of AUDIO) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    const tmp = path.join(dir, `cut.${name}`);
    await make(file, tmp, 'audio');
    replace(tmp, name);
  }

  set(0.92, 'thumbnails');
  const info = await probe(cfg, path.join(dir, sourceFile));
  const duration = Math.min(length, info.duration || length);
  const thumbs = await posterAndThumbs(cfg, dir, duration, media);
  set(1, 'done');
  return { ...media, ...info, duration, ready: true, proxy: 'proxy.mp4', sourceFile, thumbs };
}

/** The export source's encoding: high quality H.264 and AAC, for whichever streams the source has. */
const sourceCodecs = (media: Media): string[] => [
  ...(media.hasVideo ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p'] : []),
  ...(media.hasAudio ? ['-c:a', 'aac', '-b:a', '256k'] : []),
  '-movflags',
  '+faststart',
];

/**
 * Cut a project's media down to one stretch, so the project starts at its first frame and ends at its last
 * (a party round keeps only the slice the players dubbed). Frame- and sample-accurate: the source is re-encoded
 * (H.264 + AAC, high quality) and becomes the export source, the proxy and the working audio are cut from their own
 * files, poster and thumbnails are made again.
 */
export async function cutMedia(cfg: MediaConfig, dir: string, media: Media, range: TimeRange, set: Progress = noop): Promise<Media> {
  const start = Math.max(0, range.start);
  const len = Math.max(0.1, Math.min(range.end, media.duration || range.end) - start);
  const at = ['-ss', start.toFixed(3)];
  const span = ['-t', len.toFixed(3)];
  const make: Make = async (input, out, kind, onProgress) => {
    if (kind === 'source') {
      const maps = [...(media.hasVideo ? ['-map', '0:v:0'] : []), ...(media.hasAudio ? ['-map', '0:a:0'] : [])];
      await runFfmpeg(cfg, [...at, '-i', input, ...span, ...maps, ...sourceCodecs(media), out], { durationSec: len, onProgress });
    } else if (kind === 'proxy') {
      await runFfmpeg(cfg, [...at, '-i', input, ...span, '-map', '0:v:0', '-an', ...proxyEncoding(media), out]);
    } else await runFfmpeg(cfg, [...at, '-i', input, ...span, '-c:a', 'pcm_s16le', out]);
  };
  return rebuild(cfg, dir, media, len, make, set);
}

/** What a montage's pieces must share to be joined: the picture's size and rate, the sound's rate and channels. */
interface Format {
  video: { width: number; height: number; fps: number } | null;
  audio: { rate: number; layout: 'mono' | 'stereo' } | null;
}

/**
 * ffmpeg arguments that join the parts into one file: each stretch of `input` (cut by seeking, so only what is used is
 * decoded) and each gap (black picture, silence), all brought to the same format first. `encode` follows.
 */
function montageArgs(input: string, out: string, parts: MediaPart[], f: Format, encode: string[]): string[] {
  const args: string[] = [];
  const chains: string[] = [];
  const ends: string[] = [];
  let n = 0; // ffmpeg input index
  parts.forEach((part, i) => {
    const gap = isGap(part);
    const seconds = gap ? part.gap : part.end - part.start;
    const d = Math.max(0.04, seconds).toFixed(3);
    let v = -1;
    let a = -1;
    if (gap) {
      if (f.video) {
        args.push('-f', 'lavfi', '-t', d, '-i', `color=c=black:s=${f.video.width}x${f.video.height}:r=${f.video.fps}`);
        v = n++;
      }
      if (f.audio) {
        args.push('-f', 'lavfi', '-t', d, '-i', `anullsrc=r=${f.audio.rate}:cl=${f.audio.layout}`);
        a = n++;
      }
    } else {
      args.push('-ss', part.start.toFixed(3), '-t', d, '-i', input);
      v = a = n++;
    }
    if (f.video) {
      const { width: w, height: h, fps } = f.video;
      chains.push(
        `[${v}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[v${i}]`,
      );
      ends.push(`[v${i}]`);
    }
    if (f.audio) {
      chains.push(`[${a}:a]aformat=sample_rates=${f.audio.rate}:channel_layouts=${f.audio.layout},asetpts=PTS-STARTPTS[a${i}]`);
      ends.push(`[a${i}]`);
    }
  });
  // concat takes each part's picture then its sound; the pieces are all cut to length, so they end together
  const joined = `${ends.join('')}concat=n=${parts.length}:v=${f.video ? 1 : 0}:a=${f.audio ? 1 : 0}${f.video ? '[v]' : ''}${f.audio ? '[a]' : ''}`;
  const map = [...(f.video ? ['-map', '[v]'] : []), ...(f.audio ? ['-map', '[a]'] : [])];
  return [...args, '-filter_complex', [...chains, joined].join(';'), ...map, ...encode, out];
}

/**
 * Build a montage from a project's media: the parts in order, each a stretch of the source or a gap of black and
 * silence (a trailer's title cards sit on the gaps). Same contract as `cutMedia`: every file follows the picture,
 * is written aside and renamed over the old one, and the new media comes back for the caller to save. Sound with
 * more than two channels is mixed down to stereo (the pieces must share a layout to be joined).
 */
export async function assembleMedia(cfg: MediaConfig, dir: string, media: Media, parts: MediaPart[], set: Progress = noop): Promise<Media> {
  if (!parts.length) throw new Error('nothing to assemble');
  const length = parts.reduce((sum, p) => sum + (isGap(p) ? p.gap : p.end - p.start), 0);
  const layoutOf = (channels: number): 'mono' | 'stereo' => (channels > 1 ? 'stereo' : 'mono');
  const make: Make = async (input, out, kind, onProgress) => {
    if (kind === 'source') {
      const format: Format = {
        video: media.hasVideo ? { width: media.width, height: media.height, fps: media.fps || 25 } : null,
        audio: media.hasAudio ? { rate: media.sampleRate || 48000, layout: layoutOf(media.channels) } : null,
      };
      await runFfmpeg(cfg, montageArgs(input, out, parts, format, sourceCodecs(media)), { durationSec: length, onProgress });
      return;
    }
    const info = await probe(cfg, input);
    if (kind === 'proxy') {
      const format: Format = { video: { width: info.width, height: info.height, fps: info.fps || 25 }, audio: null };
      await runFfmpeg(cfg, montageArgs(input, out, parts, format, [...proxyCodec(media), '-an']));
      return;
    }
    const format: Format = { video: null, audio: { rate: info.sampleRate || 48000, layout: layoutOf(info.channels) } };
    await runFfmpeg(cfg, montageArgs(input, out, parts, format, ['-c:a', 'pcm_s16le']));
  };
  return rebuild(cfg, dir, media, length, make, set);
}
