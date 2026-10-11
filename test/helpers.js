import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { make, OUT } from './fixtures/make.js';

export const fixtures = () => { make(); return OUT; };
export const fx = (name) => path.join(fixtures(), name);

export async function startApp(overrides = {}) {
  process.env.OPENROUTER_API_KEY = overrides.apiKey ?? 'test-key-not-real';
  const { createServer } = await import('../server/index.js');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doblaje-test-'));
  const app = await createServer({ dataDir, port: 0, host: '127.0.0.1', ...overrides });
  const port = await app.listen();
  const base = `http://127.0.0.1:${port}`;
  const api = async (method, url, body, headers = {}) => {
    const isBuf = body instanceof Buffer || body instanceof Uint8Array;
    const r = await fetch(base + url, { method, headers: { connection: 'close', ...(body && !isBuf ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? (isBuf ? body : JSON.stringify(body)) : undefined });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, headers: r.headers };
  };
  const waitJob = async (id, timeoutMs = 120000) => {
    const t0 = Date.now();
    for (;;) {
      const { data } = await api('GET', `/api/jobs/${id}`);
      if (data.status === 'done') return data;
      if (data.status === 'error') throw new Error('job failed: ' + data.error);
      if (Date.now() - t0 > timeoutMs) throw new Error('job timeout');
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const ingestFixture = async (name, mode = 'pro') => {
    const r = await api('POST', '/api/projects/from-path', { path: fx(name), mode });
    if (r.status !== 202) throw new Error('from-path failed ' + JSON.stringify(r.data));
    await waitJob(r.data.job);
    return r.data.project.id;
  };
  const close = async () => { app.server.closeAllConnections?.(); await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); };
  return { app, base, api, waitJob, ingestFixture, close, dataDir, dir: (id) => path.join(dataDir, 'projects', id) };
}

export function ffprobeJson(file) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString());
}
/** mean/max volume in dB over a time window of a media file */
export function meanDb(file, ss = 0, t = null) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-ss', String(ss), ...(t ? ['-t', String(t)] : []), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr);
  return m ? (m[1] === '-inf' ? -120 : Number(m[1])) : -120;
}

/** mean absolute difference (0..255) between two frames cropped from videos; tolerant to re-encoding noise */
export function frameDiff(fileA, fileB, t, crop) {
  const raw = (f) => spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `crop=${crop},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 }).stdout;
  const a = raw(fileA), b = raw(fileB);
  let sum = 0; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / Math.max(1, n);
}
