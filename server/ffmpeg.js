import { spawn } from 'node:child_process';

/** Run a binary, collect stdout/stderr. Rejects on non-zero exit with the stderr tail. */
export function exec(bin, args, { input, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = []; const err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { err.push(d); if (err.length > 400) err.shift(); });
    let timer; if (timeoutMs) timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); reject(new Error(`${bin}: ${e.message}`)); });
    p.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out); const stderr = Buffer.concat(err).toString('utf8');
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited ${code}: ${stderr.split('\n').slice(-8).join('\n')}`));
    });
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

/**
 * Run ffmpeg with progress reporting. `durationSec` lets us turn out_time into a 0..1 fraction.
 */
export function runFfmpeg(cfg, args, { durationSec = 0, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const full = ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...args];
    const p = spawn(cfg.ffmpeg, full, { stdio: ['ignore', 'pipe', 'pipe'] });
    const err = [];
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && durationSec && onProgress) onProgress(Math.min(1, Number(m[1]) / 1e6 / durationSec));
      }
    });
    p.stderr.on('data', (d) => { err.push(d); if (err.length > 300) err.shift(); });
    p.on('error', (e) => reject(new Error(`ffmpeg: ${e.message}`)));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(err).toString('utf8').split('\n').slice(-10).join('\n')}`));
    });
  });
}

const frac = (s) => { if (!s) return 0; const [a, b] = String(s).split('/').map(Number); return b ? a / b : a || 0; };

export async function probe(cfg, file) {
  const { stdout } = await exec(cfg.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(stdout.toString('utf8'));
  const v = j.streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const fps = v ? (frac(v.avg_frame_rate) || frac(v.r_frame_rate) || 25) : 0;
  const rot = Number(v?.side_data_list?.find((d) => 'rotation' in d)?.rotation || v?.tags?.rotate || 0);
  const swap = Math.abs(rot) % 180 === 90;
  const duration = Number(j.format?.duration) || Number(v?.duration) || Number(a?.duration) || 0;
  return {
    duration,
    container: j.format?.format_name,
    hasVideo: !!v, hasAudio: !!a,
    width: v ? (swap ? v.height : v.width) : 0,
    height: v ? (swap ? v.width : v.height) : 0,
    fps: Math.round(fps * 1000) / 1000,
    vcodec: v?.codec_name || null, pixFmt: v?.pix_fmt || null, vbitrate: Number(v?.bit_rate) || 0,
    acodec: a?.codec_name || null,
    channels: a?.channels || 0, channelLayout: a?.channel_layout || null, sampleRate: Number(a?.sample_rate) || 0,
    bitrate: Number(j.format?.bit_rate) || 0, size: Number(j.format?.size) || 0,
  };
}

/** Parse ffmpeg's silencedetect output into speech-like segments. */
export function parseSilence(stderr, duration) {
  const starts = []; const silences = [];
  for (const m of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const t = Number(m[2]);
    if (m[1] === 'start') starts.push(Math.max(0, t));
    else if (starts.length) silences.push([starts.pop(), t]);
  }
  if (starts.length) silences.push([starts.pop(), duration]);
  silences.sort((a, b) => a[0] - b[0]);
  const segs = []; let cur = 0;
  for (const [s, e] of silences) { if (s > cur) segs.push([cur, s]); cur = Math.max(cur, e); }
  if (cur < duration) segs.push([cur, duration]);
  return segs;
}
