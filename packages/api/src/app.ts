import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { OpenRouter } from '@doblaje/ai';
import { AppError, errorMessage } from '@doblaje/core';
import { AiLedger, closeDatabase, isProjectId, openDatabase, SqliteProjectRepository } from '@doblaje/db';
import { exec } from '@doblaje/media';
import { type ConfigOverrides, loadConfig } from './config.ts';
import type { AppContext } from './context.ts';
import { serveHf } from './hf.ts';
import { json, safeJoin, serveFile } from './http.ts';
import { Jobs } from './jobs.ts';
import { Router } from './router.ts';
import { projectRoutes } from './routes/projects.ts';
import { aiRoutes, systemRoutes } from './routes/system.ts';

/** Files of a project folder that may be fetched by the browser. */
const MEDIA_FILES =
  /^(source\.(webm|mp4|mov|mkv|m4v)|proxy\.mp4|poster\.jpg|thumbs\.jpg|audio_orig\.wav|audio_16k\.wav|stem_dialogue\.wav|stem_bg\.wav|takes\/[\w.-]+\.wav|exports\/[\w.-]+(\/[\w.-]+)?)$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const VENDOR_CACHE = 'public, max-age=86400';

export interface App {
  server: http.Server;
  ctx: AppContext;
  listen(): Promise<number>;
  close(): Promise<void>;
}

/**
 * Compose the whole backend: database, repositories, AI client, job runner, routes and static files.
 * Used by the server shell (apps/server), the desktop shell (apps/desktop) and the tests.
 */
export async function createApp(overrides: ConfigOverrides = {}): Promise<App> {
  const cfg = loadConfig(overrides);
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const db = openDatabase({ file: cfg.dbFile, migrationsFolder: cfg.migrationsDir });
  const projects = new SqliteProjectRepository(db, cfg.projectsDir);
  let ffmpegVersion = '';
  try {
    ffmpegVersion = (await exec(cfg.media.ffmpeg, ['-version'])).stdout.toString().split('\n')[0];
  } catch {
    ffmpegVersion = '';
  }
  const ctx: AppContext = {
    cfg,
    db,
    projects,
    jobs: new Jobs(),
    ai: new OpenRouter(cfg.ai, new AiLedger(db)),
    ffmpegVersion,
    localOnly: ['127.0.0.1', 'localhost', '::1'].includes(cfg.host),
  };
  const router = new Router();
  systemRoutes(router, ctx);
  aiRoutes(router, ctx);
  projectRoutes(router, ctx);
  const vendor = cfg.vendorDirs;

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', 'http://x');
    const p = decodeURIComponent(url.pathname);
    // DNS-rebinding / CSRF guard: the API controls local files and a paid key, so only same-origin local use.
    const hostName = (req.headers.host || '').replace(/:\d+$/, '');
    if (ctx.localOnly && !LOOPBACK_HOSTS.has(hostName)) throw new AppError(403, 'forbidden host');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
      throw new AppError(403, 'cross-origin request blocked');
    }
    if (p.startsWith('/api/')) {
      if (await router.handle(req, res, url)) return;
      throw new AppError(404, 'not found');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError(404, 'not found');
    if (p.startsWith('/media/')) {
      const [, , id, ...rest] = p.split('/');
      const name = rest.join('/');
      if (!isProjectId(id) || !MEDIA_FILES.test(name) || name.includes('..')) throw new AppError(404, 'not found');
      const download = name.startsWith('exports/') ? path.basename(name) : name.startsWith('source.') ? originalName(id, name) : undefined;
      return serveFile(req, res, path.join(projects.dir(id), name), { download });
    }
    if (p.startsWith('/hf/')) return serveHf(cfg.modelsDir, req, res, p.slice(4));
    if (p.startsWith('/vendor/transformers/')) return serveFile(req, res, safeJoin(vendor.transformers, p.slice(21)), { cache: VENDOR_CACHE });
    if (p.startsWith('/vendor/ort/')) return serveFile(req, res, safeJoin(vendor.ort, p.slice(12)), { cache: VENDOR_CACHE });
    if (!cfg.webDir) throw new AppError(404, 'web app not built (run: pnpm build)');
    const f = safeJoin(cfg.webDir, p === '/' ? 'index.html' : p.slice(1));
    const hashed = p.startsWith('/assets/');
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return serveFile(req, res, path.join(cfg.webDir, 'index.html')); // SPA fallback
    return serveFile(req, res, f, { cache: hashed ? 'public, max-age=31536000, immutable' : 'no-cache' });
  }

  const originalName = (id: string, name: string) => {
    const base = projects
      .get(id)
      .name.normalize('NFKD')
      .replace(/[^\w.\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 80);
    return `${base || 'recording'}_original${path.extname(name)}`;
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      const status = e instanceof AppError ? e.status : 500;
      if (status >= 500) console.error('[server]', req.method, req.url, e);
      if (!res.headersSent) json(res, status, { error: errorMessage(e) || 'error', ...(e instanceof AppError && e.code ? { code: e.code } : {}) });
      else res.destroy();
    });
  });
  server.requestTimeout = 0; // long uploads
  return {
    server,
    ctx,
    listen: () => new Promise((resolve) => server.listen(cfg.port, cfg.host, () => resolve((server.address() as AddressInfo).port))),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          closeDatabase(db);
          resolve();
        });
      }),
  };
}
