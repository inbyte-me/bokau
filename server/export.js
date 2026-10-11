import fs from 'node:fs';
import path from 'node:path';
import { runFfmpeg } from './ffmpeg.js';
import { toSrt, toJson } from '../shared/srt.js';
import { buildSubtitleTrack, renderWatermarkPng } from './subpng.js';
import { safeName, uid } from './util.js';

const MP4_VIDEO = new Set(['h264', 'hevc', 'av1', 'mpeg4']);
const WEBM_VIDEO = new Set(['vp8', 'vp9', 'av1']);

/** Which container can hold the original video stream untouched? */
export function copyContainer(vcodec) {
  if (MP4_VIDEO.has(vcodec)) return 'mp4';
  if (WEBM_VIDEO.has(vcodec)) return 'webm';
  return 'mkv';
}

export function planExport(media, opts) {
  const o = { profile: 'quick', format: 'mp4', burnSubs: false, watermark: null, vertical: null, targetMb: 0, loudnorm: false, maxHeight: 1080, ...opts };
  const needsRender = !!(o.burnSubs || o.watermark?.text || o.vertical?.enabled || (o.maxHeight && media.height > o.maxHeight && o.profile === 'quick' && o.allowDownscale));
  const hasVideo = media.hasVideo;
  const fast = hasVideo && !needsRender && o.fast !== false;
  let container = o.format === 'webm' ? 'webm' : 'mp4';
  if (fast) container = copyContainer(media.vcodec);
  return { ...o, fast, container, needsRender, hasVideo };
}

/**
 * Compose the final files. `mixWav` is the browser-rendered mix (identical to what you heard in preview).
 * Returns list of produced files (relative to exportDir).
 */
export async function runExport(cfg, projects, id, opts, job) {
  const p = projects.get(id);
  const dir = projects.dir(id);
  const media = p.media;
  const plan = planExport(media, opts);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + uid(3);
  const base = safeName(p.name, 'dub');
  const outDir = path.join(dir, 'exports', plan.profile === 'archive' ? `${base}_${stamp}` : stamp);
  fs.mkdirSync(outDir, { recursive: true });
  const set = (progress, message) => { job.progress = progress; job.message = message; };
  const renders = path.join(dir, 'renders');
  const mix = path.join(renders, 'mix.wav');
  if (!fs.existsSync(mix)) throw new Error('No rendered mix uploaded');
  const src = path.join(dir, media.sourceFile);
  const files = [];
  const duration = media.duration;

  const aExt = plan.container === 'webm' ? 'webm' : plan.container;
  const outName = plan.profile === 'archive' ? 'video_mixed.' + aExt : `${base}.${aExt}`;
  const outFile = path.join(outDir, outName);
  const aEnc = plan.container === 'webm' ? ['-c:a', 'libopus', '-b:a', '160k'] : ['-c:a', 'aac', '-b:a', plan.profile === 'archive' ? '320k' : '192k'];
  const afilters = plan.loudnorm ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11'] : [];

  if (!plan.hasVideo) {
    set(0.1, 'audio');
    await runFfmpeg(cfg, ['-i', mix, ...afilters, ...aEnc, path.join(outDir, `${base}.m4a`)]);
    files.push(`${base}.m4a`);
  } else if (plan.fast) {
    set(0.1, 'remux');
    const tag = media.vcodec === 'hevc' && plan.container === 'mp4' ? ['-tag:v', 'hvc1'] : [];
    await runFfmpeg(cfg, ['-i', src, '-i', mix, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', ...tag, ...afilters, ...aEnc, '-shortest', ...(plan.container === 'mp4' ? ['-movflags', '+faststart'] : []), outFile],
      { durationSec: duration, onProgress: (f) => set(0.1 + f * 0.8, 'remux') });
    files.push(outName);
  } else {
    // full render: scale/crop, burn subtitles, watermark
    let w = media.width, h = media.height;
    const vf = [];
    if (plan.vertical?.enabled) {
      const fx = Math.min(1, Math.max(0, plan.vertical.focusX ?? 0.5));
      const ow = Math.round((h * 9) / 16 / 2) * 2;
      vf.push(`crop=${ow}:${h}:(iw-${ow})*${fx.toFixed(3)}:0`); w = ow;
      const th = plan.maxHeight >= 1920 || h >= 1920 ? 1920 : h >= 1280 ? 1280 : 0;
      if (th) { vf.push(`scale=${th * 9 / 16}:${th}`); w = th * 9 / 16; h = th; }
    } else if (plan.maxHeight && h > plan.maxHeight) {
      const nh = plan.maxHeight; const nw = Math.round((w * nh) / h / 2) * 2;
      vf.push(`scale=${nw}:${nh}`); w = nw; h = nh;
    }
    vf.push('format=yuv420p');
    const inputs = ['-i', src, '-i', mix];
    let chain = `[0:v]${vf.join(',')}[v0]`; let last = 'v0'; let idx = 2;
    if (plan.burnSubs && p.cues.length) {
      set(0.05, 'subtitles');
      const sub = buildSubtitleTrack(path.join(outDir, '.tmp_subs'), p.cues, { width: w, height: h, duration });
      inputs.push('-f', 'concat', '-safe', '0', '-i', sub.listFile);
      chain += `;[${idx}:v]format=rgba[sb];[${last}][sb]overlay=0:H-h-${Math.round(h * 0.04)}:eof_action=pass[v${idx}]`;
      last = `v${idx}`; idx++;
    }
    if (plan.watermark?.text) {
      const wm = renderWatermarkPng(plan.watermark.text.slice(0, 60), Math.max(16, Math.round(h * 0.035)), 0.65);
      const wmFile = path.join(outDir, '.tmp_wm.png'); fs.writeFileSync(wmFile, wm.png);
      inputs.push('-i', wmFile);
      const pos = { tl: '12:12', tr: 'W-w-12:12', bl: '12:H-h-12', br: 'W-w-12:H-h-12' }[plan.watermark.pos || 'br'];
      chain += `;[${last}][${idx}:v]overlay=${pos}[v${idx}]`;
      last = `v${idx}`; idx++;
    }
    const vEnc = plan.container === 'webm'
      ? ['-c:v', 'libvpx-vp9', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '5', ...(plan.targetMb ? bitrateArgs(plan.targetMb, duration, true) : ['-crf', '33', '-b:v', '0'])]
      : ['-c:v', 'libx264', '-preset', plan.profile === 'archive' ? 'slow' : 'veryfast', ...(plan.targetMb ? bitrateArgs(plan.targetMb, duration, false) : ['-crf', plan.profile === 'archive' ? '16' : '23']), '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
    set(0.1, 'render');
    await runFfmpeg(cfg, [...inputs, '-filter_complex', chain, '-map', `[${last}]`, '-map', '1:a:0', ...vEnc, ...afilters, ...aEnc, '-t', String(duration), outFile],
      { durationSec: duration, onProgress: (f) => set(0.1 + f * 0.8, 'render') });
    fs.rmSync(path.join(outDir, '.tmp_subs'), { recursive: true, force: true });
    fs.rmSync(path.join(outDir, '.tmp_wm.png'), { force: true });
    files.push(outName);
  }

  if (plan.profile === 'archive') {
    set(0.92, 'stems');
    const stems = { 'bg.wav': 'stem_original_music_sfx.wav', 'dry.wav': 'stem_user_voice_dry.wav', 'wet.wav': 'stem_user_voice_wet.wav' };
    for (const [from, to] of Object.entries(stems)) {
      const f = path.join(renders, from);
      if (fs.existsSync(f)) { fs.copyFileSync(f, path.join(outDir, to)); files.push(to); }
    }
  }
  if (plan.subtitles !== false && p.cues.length) {
    fs.writeFileSync(path.join(outDir, `${base}.srt`), toSrt(p.cues));
    fs.writeFileSync(path.join(outDir, `${base}.json`), toJson(p.cues, { project: p.name, duration }));
    files.push(`${base}.srt`, `${base}.json`);
  }
  const sizes = Object.fromEntries(files.map((f) => [f, fs.statSync(path.join(outDir, f)).size]));
  return { dir: path.relative(path.join(dir, 'exports'), outDir), files, sizes, plan: { fast: plan.fast, container: plan.container } };
}

function bitrateArgs(targetMb, duration, vp9) {
  const totalKbps = (targetMb * 8 * 1024) / Math.max(1, duration);
  const v = Math.max(120, Math.floor((totalKbps - 192) * 0.92));
  return vp9 ? ['-b:v', `${v}k`, '-maxrate', `${Math.floor(v * 1.3)}k`, '-bufsize', `${v * 2}k`] : ['-b:v', `${v}k`, '-maxrate', `${Math.floor(v * 1.3)}k`, '-bufsize', `${v * 2}k`];
}
