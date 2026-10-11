import fs from 'node:fs';
import path from 'node:path';
import { exec, runFfmpeg, parseSilence } from './ffmpeg.js';

const SURROUND = {
  '5.1': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR'],
  '5.1(side)': ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR'],
  '7.1': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'SL', 'SR'],
};

const meanVolume = async (cfg, file, expr) => {
  const { stderr } = await exec(cfg.ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-af', `pan=mono|c0=${expr},volumedetect`, '-f', 'null', '-']);
  const m = /mean_volume: (-?[\d.]+|-inf) dB/.exec(stderr);
  return m && m[1] !== '-inf' ? Number(m[1]) : -120;
};

/** How far apart are L and R? Returns dB of side relative to mid (very negative => effectively mono). */
export async function stereoSpread(cfg, wav) {
  const mid = await meanVolume(cfg, wav, '0.5*c0+0.5*c1');
  const side = await meanVolume(cfg, wav, '0.5*c0-0.5*c1');
  return { midDb: mid, sideDb: side, relDb: side - mid };
}

/**
 * Split the original audio into Dialogue and Background (music + SFX).
 *  - 5.1/7.1 sources: dialogue is the centre channel, background is everything else (exact, clean).
 *  - stereo sources: band-limited centre-channel extraction (150 Hz..7 kHz). dialogue + background == original.
 *  - (near-)mono sources can't be separated this way -> status 'unsupported'.
 */
export async function separateStems(cfg, projects, id, job) {
  const dir = projects.dir(id);
  const p = projects.get(id);
  if (!p.media?.hasAudio) throw new Error('This clip has no audio to separate');
  const orig = path.join(dir, 'audio_orig.wav');
  const dlg = path.join(dir, 'stem_dialogue.wav');
  const bg = path.join(dir, 'stem_bg.wav');
  const dur = p.media.duration;
  const set = (progress, message) => { if (job) { job.progress = progress; job.message = message; } };
  const layout = p.media.channelLayout;
  const src = path.join(dir, p.media.sourceFile || 'source');
  let method; let spread = null;

  if (SURROUND[layout] && fs.existsSync(src)) {
    method = 'surround-center';
    const ch = SURROUND[layout];
    const side = (names) => names.filter((n) => ch.includes(n));
    const L = ['FL', ...side(['BL', 'SL']).map((n) => `0.7*${n}`), ...side(['LFE']).map((n) => `0.5*${n}`)].join('+');
    const R = ['FR', ...side(['BR', 'SR']).map((n) => `0.7*${n}`), ...side(['LFE']).map((n) => `0.5*${n}`)].join('+');
    set(0.1, 'dialogue');
    await runFfmpeg(cfg, ['-i', src, '-map', '0:a:0', '-af', 'pan=stereo|c0=FC|c1=FC,aresample=48000', '-c:a', 'pcm_s16le', dlg], { durationSec: dur, onProgress: (f) => set(0.1 + f * 0.4, 'dialogue') });
    set(0.5, 'background');
    await runFfmpeg(cfg, ['-i', src, '-map', '0:a:0', '-af', `pan=stereo|c0=${L}|c1=${R},aresample=48000`, '-c:a', 'pcm_s16le', bg], { durationSec: dur, onProgress: (f) => set(0.5 + f * 0.5, 'background') });
  } else {
    spread = await stereoSpread(cfg, orig);
    if (p.media.channels < 2 || spread.relDb < -35) {
      const upd = projects.get(id);
      upd.stems = { status: 'unsupported', method: null, reason: 'mono', spread };
      projects.save(upd);
      return upd.stems;
    }
    method = 'stereo-center-cut';
    // One shared crossover => dialogue + background sum back to the original (up to an all-pass phase shift).
    // mid band: centre part (L+R)/2 is dialogue, the remainder (side) stays in the background.
    const k = 0.47; // centre removal strength 0.94 keeps a little ambience in the bg
    set(0.1, 'separating');
    await runFfmpeg(cfg, ['-i', orig, '-filter_complex',
      `[0:a]acrossover=split=150 7000:order=4th[lo][mid][hi];[mid]asplit=2[m1][m2];` +
      `[m1]pan=stereo|c0=${k}*c0+${k}*c1|c1=${k}*c0+${k}*c1[d];` +
      `[m2]pan=stereo|c0=${1 - k}*c0-${k}*c1|c1=${1 - k}*c1-${k}*c0[ms];` +
      `[lo][ms][hi]amix=inputs=3:normalize=0[b]`,
      '-map', '[d]', '-c:a', 'pcm_s16le', dlg, '-map', '[b]', '-c:a', 'pcm_s16le', bg],
    { durationSec: dur, onProgress: (f) => set(0.1 + f * 0.9, 'separating') });
  }
  const upd = projects.get(id);
  upd.stems = { status: 'ready', method, spread, createdAt: new Date().toISOString() };
  projects.save(upd);
  return upd.stems;
}

/** Detect speech-like segments from (dialogue stem or) the STT audio. */
export async function detectSpeech(cfg, projects, id, { noiseDb, minSilence = 0.3, minSpeech = 0.25, mergeGap = 0.25 } = {}) {
  const dir = projects.dir(id);
  const p = projects.get(id);
  if (!p.media?.hasAudio) return [];
  const f = fs.existsSync(path.join(dir, 'stem_dialogue.wav')) ? 'stem_dialogue.wav' : 'audio_16k.wav';
  const file = path.join(dir, f);
  if (noiseDb == null) {
    // adaptive threshold: 28 dB below the loudest peak, clamped (works for quiet budget-mic sources too)
    const v = await exec(cfg.ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
    const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(v.stderr)?.[1] ?? -6);
    noiseDb = Math.max(-55, Math.min(-25, peak - 28));
  }
  const { stderr } = await exec(cfg.ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilence}`, '-f', 'null', '-']);
  let segs = parseSilence(stderr, p.media.duration);
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && s[0] - last[1] < mergeGap) last[1] = s[1]; else merged.push([...s]);
  }
  return merged.filter(([a, b]) => b - a >= minSpeech).map(([start, end]) => ({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 }));
}

/** Mic clean-up for budget mics: rumble filter, FFT denoise, gentle compression, peak-normalize. */
export async function cleanTake(cfg, inFile, outFile) {
  const chain = 'highpass=f=85,afftdn=nr=14:nf=-38:tn=1,acompressor=threshold=-22dB:ratio=3:attack=5:release=90:makeup=3';
  const tmp = outFile + '.tmp.wav';
  await runFfmpeg(cfg, ['-i', inFile, '-af', chain, '-c:a', 'pcm_s16le', tmp]);
  const { stderr } = await exec(cfg.ffmpeg, ['-hide_banner', '-nostdin', '-i', tmp, '-af', 'volumedetect', '-f', 'null', '-']);
  const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(stderr)?.[1] ?? -3);
  const gain = Math.max(-6, Math.min(24, -3 - peak));
  await runFfmpeg(cfg, ['-i', tmp, '-af', `volume=${gain.toFixed(2)}dB`, '-c:a', 'pcm_s16le', outFile]);
  fs.rmSync(tmp, { force: true });
  return { gainDb: gain };
}
