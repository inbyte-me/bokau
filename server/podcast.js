import fs from 'node:fs';
import path from 'node:path';
import { exec, runFfmpeg } from './ffmpeg.js';
import { safeName, uid } from './util.js';
import { toSrt } from '../shared/srt.js';

const fmtChapter = (s) => { const t = Math.max(0, Math.round(s)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = t % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0')) + `:${String(sec).padStart(2, '0')}`; };

/** Voice clean-up chain for spoken word. Order matters: rumble -> denoise -> level -> loudness. */
export function voiceChain({ rumble = true, denoise = false, compress = true } = {}) {
  const f = [];
  if (rumble) f.push('highpass=f=80', 'highpass=f=80'); // 4-pole: cuts desk thumps, AC hum and mic handling
  if (denoise) f.push('afftdn=nr=12:nf=-38:tn=1');
  if (compress) f.push('acompressor=threshold=-21dB:ratio=3:attack=8:release=120:makeup=4');
  return f;
}

/** Two-pass EBU R128: measure, then apply the exact linear correction (accurate to ~0.1 LU, no pumping). */
async function measureLoudness(cfg, input, pre, ss, to) {
  const af = [...pre, 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json'].join(',');
  const { stderr } = await exec(cfg.ffmpeg, ['-hide_banner', '-nostdin', ...ss, '-i', input, ...to, '-vn', '-af', af, '-f', 'null', '-']);
  const a = stderr.lastIndexOf('{'); return JSON.parse(stderr.slice(a, stderr.indexOf('}', a) + 1));
}
export async function loudnessOf(cfg, file) {
  const { stderr } = await exec(cfg.ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const tail = stderr.slice(stderr.lastIndexOf('Summary:'));
  const num = (re) => { const m = re.exec(tail); return m ? Number(m[1]) : null; };
  return { integrated: num(/I:\s+(-?[\d.]+) LUFS/), range: num(/LRA:\s+(-?[\d.]+) LU/), truePeak: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

/**
 * Export a recorded podcast from the project's source recording.
 * opts: { format: mp3|m4a|wav|mp4|webm, clean:{rumble,denoise,compress}, loudnorm, trim:{start,end}, chapters:[{t,title}], cues? }
 */
export async function podcastExport(cfg, projects, id, opts, job) {
  const p = projects.get(id); const dir = projects.dir(id); const media = p.media;
  if (!media?.ready) throw new Error('Nothing recorded yet');
  if (!media.hasAudio) throw new Error('The recording has no audio');
  const src = path.join(dir, media.sourceFile);
  const set = (progress, message) => { job.progress = progress; job.message = message; };
  const format = ['mp3', 'm4a', 'wav', 'mp4', 'webm'].includes(opts.format) ? opts.format : 'mp3';
  const wantsVideo = (format === 'mp4' || format === 'webm');
  if (wantsVideo && !media.hasVideo) throw new Error('This recording is audio-only; choose an audio format');
  const trim = opts.trim && Number.isFinite(opts.trim.start) && Number.isFinite(opts.trim.end) && opts.trim.end > opts.trim.start ? opts.trim : null;
  const ss = trim ? ['-ss', String(trim.start)] : []; const to = trim ? ['-t', String(trim.end - trim.start)] : [];
  const dur = trim ? trim.end - trim.start : media.duration;
  const pre = voiceChain(opts.clean || {});
  const base = safeName(p.name, 'podcast'); const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + uid(3);
  const outDir = path.join(dir, 'exports', `${base}_${stamp}`); fs.mkdirSync(outDir, { recursive: true });
  const outName = `${base}.${format}`; const out = path.join(outDir, outName);

  let af = [...pre];
  if (opts.loudnorm !== false) {
    set(0.05, 'measuring loudness');
    const m = await measureLoudness(cfg, src, pre, ss, to);
    af.push(`loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`);
  }
  // chapters inside the trim. ffmpeg itself subtracts the input offset (-ss) from chapter times, so the metadata file keeps absolute times
  const t0 = trim?.start || 0, t1 = trim ? trim.end : media.duration;
  const chapters = (opts.chapters || []).map((c) => ({ t: Number(c.t), title: String(c.title || '').slice(0, 120) })).filter((c) => Number.isFinite(c.t) && c.t >= t0 && c.t < t1).sort((a, b) => a.t - b.t);
  if (chapters.length && chapters[0].t > t0 + 0.05) chapters.unshift({ t: t0, title: opts.firstChapterTitle || 'Start' }); // chapter lists must begin at 0:00
  const codec = { mp3: ['-c:a', 'libmp3lame', '-b:a', '192k'], m4a: ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'], wav: ['-c:a', 'pcm_s16le'], mp4: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'],
    webm: [...(trim ? ['-c:v', 'libvpx-vp9', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '5', '-crf', '32', '-b:v', '0'] : ['-c:v', 'copy']), '-c:a', 'libopus', '-b:a', '160k'] }[format];
  const maps = wantsVideo ? ['-map', '0:v:0', '-map', '0:a:0'] : ['-map', '0:a:0', '-vn'];
  const withChapters = chapters.length && ['m4a', 'mp4'].includes(format);
  const encoded = withChapters ? path.join(outDir, '.encoded.' + format) : out;
  set(0.2, 'encoding');
  await runFfmpeg(cfg, [...ss, '-i', src, ...to, ...maps, ...(af.length ? ['-af', af.join(',')] : []), '-map_metadata', '-1', '-metadata', `title=${p.name}`, ...codec, encoded],
    { durationSec: dur, onProgress: (f) => set(0.2 + f * 0.7, 'encoding') });
  if (withChapters) { // attach chapters in a stream-copy pass, with plain times relative to the (trimmed) output
    const lines = [';FFMETADATA1', `title=${p.name}`];
    chapters.forEach((c, i) => { const end = (chapters[i + 1]?.t ?? t1) - t0; lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round((c.t - t0) * 1000)}`, `END=${Math.round(end * 1000)}`, `title=${c.title || `Chapter ${i + 1}`}`); });
    const meta = path.join(outDir, '.chapters.ffmeta'); fs.writeFileSync(meta, lines.join('\n'));
    await runFfmpeg(cfg, ['-i', encoded, '-i', meta, '-map', '0', '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', ...(format === 'm4a' || format === 'mp4' ? ['-movflags', '+faststart'] : []), out]);
    fs.rmSync(meta, { force: true }); fs.rmSync(encoded, { force: true });
  }

  const files = [outName];
  if (chapters.length) { fs.writeFileSync(path.join(outDir, `${base}_chapters.txt`), chapters.map((c) => `${fmtChapter(c.t - t0)} ${c.title || ''}`.trim()).join('\n') + '\n'); files.push(`${base}_chapters.txt`); }
  const cues = (p.cues || []).filter((c) => c.text?.trim() && (!trim || (c.end > trim.start && c.start < trim.end))).map((c) => ({ ...c, start: Math.max(0, c.start - (trim?.start || 0)), end: Math.min(dur, c.end - (trim?.start || 0)) }));
  if (cues.length) { fs.writeFileSync(path.join(outDir, `${base}.srt`), toSrt(cues, { withCharacter: false })); fs.writeFileSync(path.join(outDir, `${base}_transcript.txt`), cues.map((c) => c.text).join('\n') + '\n'); files.push(`${base}.srt`, `${base}_transcript.txt`); }
  set(0.95, 'checking loudness');
  const loudness = await loudnessOf(cfg, out);
  const sizes = Object.fromEntries(files.map((f) => [f, fs.statSync(path.join(outDir, f)).size]));
  return { dir: path.relative(path.join(dir, 'exports'), outDir), files, sizes, loudness, seconds: dur, plan: { fast: false, container: format } };
}
