import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type ConfigOverrides, createApp, REPO_ROOT } from '@doblaje/api';
import type { Job } from '@doblaje/core';
import { make, OUT } from './fixtures.ts';

export const fixtures = () => {
  make();
  return OUT;
};
export const fx = (name: string) => path.join(fixtures(), name);

export interface ApiResponse<T = any> {
  status: number;
  data: T;
  headers: Headers;
}

/**
 * Start the real backend on a random port with a throw-away data folder and database.
 * `apiKey` defaults to a fake key so the AI routes are "configured" but every call is mocked or refused.
 */
export async function startApp(overrides: ConfigOverrides & { apiKey?: string } = {}) {
  const { apiKey, ...rest } = overrides;
  process.env.OPENROUTER_API_KEY = apiKey ?? 'test-key-not-real';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doblaje-test-'));
  const webDist = path.join(REPO_ROOT, 'apps', 'web', 'dist');
  const app = await createApp({ dataDir, port: 0, host: '127.0.0.1', envFile: null, webDir: fs.existsSync(webDist) ? webDist : null, ...rest });
  const port = await app.listen();
  const base = `http://127.0.0.1:${port}`;
  const api = async <T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse<T>> => {
    const isBuf = body instanceof Buffer || body instanceof Uint8Array;
    const r = await fetch(base + url, {
      method,
      headers: { connection: 'close', ...(body && !isBuf ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? (isBuf ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body)) : undefined,
    });
    const text = await r.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: r.status, data, headers: r.headers };
  };
  const waitJob = async (id: string, timeoutMs = 120000): Promise<Job<any>> => {
    const t0 = Date.now();
    for (;;) {
      const { data } = await api<Job>('GET', `/api/jobs/${id}`);
      if (data.status === 'done') return data;
      if (data.status === 'error') throw new Error(`job failed: ${data.error}`);
      if (Date.now() - t0 > timeoutMs) throw new Error('job timeout');
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const ingestFixture = async (name: string, mode = 'pro', { template = false } = {}): Promise<string> => {
    const r = await api('POST', '/api/projects/from-path', { path: fx(name), mode, template });
    if (r.status !== 202) throw new Error(`from-path failed ${JSON.stringify(r.data)}`);
    await waitJob(r.data.job);
    return r.data.project.id;
  };
  const close = async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { app, base, api, waitJob, ingestFixture, close, dataDir, dir: (id: string) => path.join(dataDir, 'projects', id) };
}
export type TestApp = Awaited<ReturnType<typeof startApp>>;

export function ffprobeJson(file: string): { streams: any[]; format: any; chapters?: any[] } {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', file]).toString());
}

/** mean volume in dB over a time window of a media file */
export function meanDb(file: string, ss = 0, t: number | null = null): number {
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostdin', '-ss', String(ss), ...(t ? ['-t', String(t)] : []), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const m = /mean_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr);
  return m ? (m[1] === '-inf' ? -120 : Number(m[1])) : -120;
}

/** mean absolute difference (0..255) between two frames cropped from videos; tolerant to re-encoding noise */
export function frameDiff(fileA: string, fileB: string, t: number, crop: string): number {
  const raw = (f: string) =>
    spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `crop=${crop},format=gray`, '-f', 'rawvideo', '-'], {
      maxBuffer: 1 << 26,
    }).stdout;
  const a = raw(fileA);
  const b = raw(fileB);
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / Math.max(1, n);
}
