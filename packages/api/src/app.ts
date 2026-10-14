import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { composeText, OpenRouter, rewrite, suggestLine, trailerCopy, trailerCopyOffline } from '@doblaje/ai';
import { AppError, errorMessage, isGap } from '@doblaje/core';
import { AiLedger, closeDatabase, isProjectId, isSoundId, openDatabase, SoundRepository, SqliteProjectRepository, UserRepository } from '@doblaje/db';
import { assembleMedia, cutMedia, exec, runExport } from '@doblaje/media';
import { devAuth } from './auth/dev.ts';
import { type Auth, noAuth, SESSION_COOKIE, setCookie } from './auth/index.ts';
import { workosAuth } from './auth/workos.ts';
import { type ConfigOverrides, loadConfig } from './config.ts';
import type { AppContext } from './context.ts';
import { serveHf } from './hf.ts';
import { json, safeFileName, safeJoin, serveFile } from './http.ts';
import { Jobs } from './jobs.ts';
import { createVault } from './library/vault.ts';
import { PartyHub } from './party/hub.ts';
import { lanAddresses } from './party/net.ts';
import { authRoutes, partyCreateRoutes, partyHostRoutes, partyPlayerRoutes, partyToken } from './party/routes.ts';
import { ensureCertificate } from './party/tls.ts';
import { createTranscriber } from './party/transcribe.ts';
import { RateLimit } from './ratelimit.ts';
import { Router } from './router.ts';
import { projectRoutes } from './routes/projects.ts';
import { soundRoutes } from './routes/sounds.ts';
import { aiRoutes, systemRoutes } from './routes/system.ts';

/** Files of a project folder that may be fetched by the browser. */
const MEDIA_FILES =
  /^(source\.(webm|mp4|mov|mkv|m4v)|proxy\.mp4|poster\.jpg|thumbs\.jpg|audio_orig\.wav|audio_16k\.wav|stem_dialogue\.wav|stem_bg\.wav|takes\/[\w.-]+\.wav|exports\/[\w.-]+(\/[\w.-]+)?)$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const VENDOR_CACHE = 'public, max-age=86400';
const HASHED = 'public, max-age=31536000, immutable';

export interface App {
  server: http.Server | https.Server;
  /** the HTTPS listener phones join on (null when disabled or not started) */
  lan: https.Server | null;
  ctx: AppContext;
  listen(): Promise<number>;
  close(): Promise<void>;
}

/**
 * Compose the whole backend: database, repositories, AI client, job runner, party hub, routes and static files.
 * Used by the server shell (apps/server), the desktop shell (apps/desktop) and the tests.
 *
 * Two listeners share it: the local one (studio + TV, localhost only, everything) and, for party rooms, an HTTPS
 * one on the Wi-Fi that serves only the phone app and the player routes.
 */
export async function createApp(overrides: ConfigOverrides = {}): Promise<App> {
  const cfg = loadConfig(overrides);
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const db = openDatabase({ file: cfg.dbFile, migrationsFolder: cfg.migrationsDir });
  const vault = cfg.libraryKey ? createVault(cfg.libraryKey) : null;
  const projects = new SqliteProjectRepository(db, cfg.projectsDir, vault);
  const sounds = new SoundRepository(db, cfg.soundsDir);
  const users = new UserRepository(db);
  const auth: Auth =
    cfg.auth.provider === 'workos'
      ? workosAuth(
          cfg.auth.workos ??
            (() => {
              throw new Error('AUTH_PROVIDER=workos needs WORKOS_API_KEY, WORKOS_CLIENT_ID and WORKOS_COOKIE_PASSWORD');
            })(),
        )
      : cfg.auth.provider === 'dev'
        ? devAuth()
        : noAuth;
  let ffmpegVersion = '';
  try {
    ffmpegVersion = (await exec(cfg.media.ffmpeg, ['-version'])).stdout.toString().split('\n')[0];
  } catch {
    ffmpegVersion = '';
  }
  let mainPort = 0;
  let lanPort = 0;
  const partyBase = (): string | null => {
    if (cfg.party.publicUrl) return cfg.party.publicUrl.replace(/\/$/, '');
    if (cfg.mode === 'party') return mainPort ? `${cfg.party.tls ? 'https' : 'http'}://localhost:${mainPort}` : null;
    if (lanPort) return `https://${lanAddresses()[0] ?? 'localhost'}:${lanPort}`;
    return mainPort ? `http://localhost:${mainPort}` : null;
  };
  /** the address a request really comes from: behind `trustProxy` proxies, what the nearest of them saw */
  const clientIp = (req: IncomingMessage): string => {
    const hops = cfg.party.trustProxy;
    const forwarded = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    return (hops > 0 && forwarded.length ? forwarded[Math.max(0, forwarded.length - hops)] : undefined) ?? req.socket.remoteAddress ?? '';
  };
  const creates = new RateLimit(cfg.party.createsPerHour, 3600_000);
  /** pages of other origins that may use this server (a phone app on a CDN), besides its own */
  const originAllowed = (origin: string, host: string | undefined): boolean => {
    try {
      return new URL(origin).host === host || cfg.party.origins.includes(origin.replace(/\/$/, ''));
    } catch {
      return false;
    }
  };
  const ledger = new AiLedger(db);
  const ai = new OpenRouter(cfg.ai, ledger);
  // party games write for guests who are crude on purpose: their own pair of models (a free one first, then a cheap one
  // that does not refuse), on the same key, ledger and spend cap
  const partyAi = new OpenRouter({ ...cfg.ai, defaultModel: cfg.party.aiModel, fallbackModel: cfg.party.aiFallback }, ledger);
  const party = new PartyHub({
    projects,
    sounds,
    // a clip's file, whether the library keeps it in the clear or sealed (a poster)
    clipFile: (clipId, name) => (vault?.isSealed(projects.dir(clipId)) ? vault.read(projects.dir(clipId), name) : fs.readFileSync(projects.file(clipId, name))),
    maxRooms: cfg.party.maxRooms,
    // a clip is private to its owner (the starter pack, which nobody owns, is for every host)
    mayUseClip: (ownerId, clipId) => users.mayUse(clipId, ownerId),
    // a party server forgets a room's media when everyone has left (a studio keeps its rounds as projects)
    ...(cfg.mode === 'party' ? { emptyRoomMinutes: cfg.party.emptyRoomMinutes } : {}),
    clientIp,
    originAllowed,
    ...(cfg.party.transcribe ? { transcribe: createTranscriber(cfg.media, cfg.modelsDir) } : {}),
    // the finished round as one file: the host's rendered mix over the round's picture (burning the subtitles in)
    render: async (id, { subtitles }) => {
      const out = await runExport(cfg.media, projects, id, { profile: 'quick', format: 'mp4', burnSubs: subtitles, subtitles: false });
      const made = out.files.find((f) => f.endsWith('.mp4'));
      if (!made) return null;
      fs.copyFileSync(path.join(projects.dir(id), 'exports', out.dir, made), projects.file(id, 'result.mp4'));
      fs.rmSync(path.join(projects.dir(id), 'exports', out.dir), { recursive: true, force: true });
      fs.rmSync(projects.file(id, 'renders/mix.wav'), { force: true });
      return 'result.mp4';
    },
    joinUrl: (code) => (cfg.party.joinUrl ? cfg.party.joinUrl.replace('{code}', code) : `${partyBase() ?? ''}/play/?room=${code}`),
    suggest: (input) => (partyAi.status().configured ? suggestLine(partyAi, input) : Promise.resolve(null)),
    // written games: the AI when it can, the offline generator otherwise (never blocks a party)
    write: async ({ mode, premise, genre, language, lines }) => {
      const out = language; // the players' language, whatever the scene's
      const r = await rewrite(partyAi, mode, lines, {
        prompt: mode === 'badlip' ? premise : undefined,
        genre: mode === 'genre' ? genre : undefined,
        outLang: out,
        fromLang: mode === 'badlip' ? out : undefined,
        offline: !partyAi.status().configured,
      });
      return Object.fromEntries(r.lines.map((l) => [l.id, { text: l.text, direction: l.direction }]));
    },
    // the result is the dubbed slice: its project's media is cut down to it (the media pipeline owns `media`)
    cut: async (id, parts) => {
      const p = projects.get(id);
      if (!p.media) return;
      const [only] = parts;
      const media =
        parts.length === 1 && !isGap(only)
          ? await cutMedia(cfg.media, projects.dir(id), p.media, only)
          : await assembleMedia(cfg.media, projects.dir(id), p.media, parts);
      const fresh = projects.get(id);
      fresh.media = media;
      projects.save(fresh);
    },
    // trailer games: texts nobody wrote, and the words around the trailer (never blocks: the offline copy is the floor)
    compose: (input) => (partyAi.status().configured ? composeText(partyAi, input) : Promise.resolve(null)),
    trailer: async (job) => (partyAi.status().configured ? await trailerCopy(partyAi, job) : null) ?? trailerCopyOffline(job),
  });
  const ctx: AppContext = {
    cfg,
    db,
    projects,
    sounds,
    party,
    auth,
    users,
    personOf: async (req, res) => {
      const who = await auth.resolve(req).catch(() => null);
      if (who?.cookie) {
        const secure = !!cfg.party.tls || (cfg.party.publicUrl ?? '').startsWith('https:');
        res.setHeader('set-cookie', setCookie(SESSION_COOKIE, who.cookie, { secure, maxAgeSeconds: 30 * 86400 }));
      }
      return who?.person ?? null;
    },
    partyBase,
    jobs: new Jobs(),
    ai,
    ffmpegVersion,
    localOnly: cfg.mode === 'studio' && ['127.0.0.1', 'localhost', '::1'].includes(cfg.host),
    createRoomAllowed: (req) => creates.allow(clientIp(req)),
  };
  const router = new Router();
  systemRoutes(router, ctx);
  aiRoutes(router, ctx);
  projectRoutes(router, ctx);
  soundRoutes(router, ctx);
  partyHostRoutes(router, ctx);
  partyPlayerRoutes(router, ctx);
  // what phones may reach (the Wi-Fi listener, or in a party server the only listener): never the studio's routes
  const lanRouter = new Router();
  partyPlayerRoutes(lanRouter, ctx);
  partyCreateRoutes(lanRouter, ctx); // a phone may open a room (limited per address): no TV needed
  authRoutes(lanRouter, ctx);
  const vendor = cfg.vendorDirs;

  // ---------------------------------------------------------------- shared by both listeners
  /** The phone app, the round's media for phones, background sounds. Returns false when the path is not one of these. */
  async function servePartyFiles(req: IncomingMessage, res: ServerResponse, url: URL, p: string, { lan }: { lan: boolean }): Promise<boolean> {
    if (p === '/play') {
      res.writeHead(301, { location: `/play/${url.search}` });
      res.end();
      return true;
    }
    if (p.startsWith('/play/')) {
      if (!cfg.playDir) throw new AppError(404, 'phone app not built (run: pnpm build)');
      const f = safeJoin(cfg.playDir, p.slice(6) || 'index.html');
      if (!fs.existsSync(f) || !fs.statSync(f).isFile()) serveFile(req, res, path.join(cfg.playDir, 'index.html'));
      else serveFile(req, res, f, { cache: p.startsWith('/play/assets/') ? HASHED : 'no-cache' });
      return true;
    }
    if (p.startsWith('/party/')) {
      const [, , code, kind, ...rest] = p.split('/');
      if (kind === 'clips' && rest.length === 2 && rest[1] === 'poster.jpg' && isProjectId(rest[0])) {
        const poster = party.poster(code, partyToken(req, url), rest[0]);
        res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': poster.length, 'cache-control': 'private, max-age=3600' });
        res.end(req.method === 'HEAD' ? undefined : poster);
        return true;
      }
      if (kind !== 'media') throw new AppError(404, 'not found');
      const name = rest.join('/');
      // `?download=1` on the result: a file name that says what it is, and the browser saves it instead of playing it
      const download =
        name === 'result.mp4' && url.searchParams.get('download')
          ? `${safeFileName(party.player(code, partyToken(req, url)).entry.clip?.name) || 'party'}_${code}.mp4`
          : undefined;
      serveFile(req, res, party.mediaFile(code, partyToken(req, url), name), { download });
      return true;
    }
    if (p.startsWith('/sounds/')) {
      const m = /^\/sounds\/(s[a-f0-9]{10})\.m4a$/.exec(p);
      if (!m || !isSoundId(m[1])) throw new AppError(404, 'not found');
      if (lan && !party.knows(partyToken(req, url))) throw new AppError(403, 'join a room first');
      serveFile(req, res, sounds.file(m[1]), { cache: 'public, max-age=86400' });
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- local listener
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', 'http://x');
    const p = decodeURIComponent(url.pathname);
    // DNS-rebinding / CSRF guard: the API controls local files and a paid key, so only same-origin local use.
    const hostName = (req.headers.host || '').replace(/:\d+$/, '');
    if (ctx.localOnly && !LOOPBACK_HOSTS.has(hostName)) throw new AppError(403, 'forbidden host');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
      throw new AppError(403, 'cross-origin request blocked');
    }
    if (p === '/healthz') return json(res, 200, { ok: true, mode: cfg.mode, rooms: party.size });
    if (p.startsWith('/api/')) {
      if (await router.handle(req, res, url)) return;
      throw new AppError(404, 'not found');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError(404, 'not found');
    if (await servePartyFiles(req, res, url, p, { lan: false })) return;
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
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return serveFile(req, res, path.join(cfg.webDir, 'index.html')); // SPA fallback
    return serveFile(req, res, f, { cache: p.startsWith('/assets/') ? HASHED : 'no-cache' });
  }

  // ---------------------------------------------------------------- party listener (Wi-Fi HTTPS, or the whole server in party mode)
  /** Headers every party response carries: no sniffing, no referrers, the microphone for this origin only, HTTPS pinned. */
  const guard = (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('permissions-policy', 'microphone=(self), camera=(), geolocation=()');
    const secure = !!cfg.party.tls || String(req.headers['x-forwarded-proto'] ?? '') === 'https' || (req.socket as { encrypted?: boolean }).encrypted === true;
    if (secure && cfg.mode === 'party') res.setHeader('strict-transport-security', 'max-age=31536000');
    // a phone app served from another origin (a CDN): let exactly the configured origins in
    const origin = req.headers.origin;
    if (origin && cfg.party.origins.includes(origin.replace(/\/$/, ''))) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', 'content-type, x-party-token, x-party-host');
      res.setHeader('access-control-allow-methods', 'GET, POST, HEAD, OPTIONS');
      res.setHeader('access-control-max-age', '600');
    }
  };
  /** Phones only: the phone app, the player routes and the round's media. Nothing of the studio or the AI. */
  async function handleParty(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', 'https://x');
    const p = decodeURIComponent(url.pathname);
    guard(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin && !originAllowed(req.headers.origin, req.headers.host)) {
      throw new AppError(403, 'cross-origin request blocked');
    }
    if (p === '/healthz') return json(res, 200, { ok: true, mode: cfg.mode, rooms: party.size });
    if (p === '/') {
      res.writeHead(302, { location: '/play/' });
      res.end();
      return;
    }
    if (p.startsWith('/api/') || p.startsWith('/auth/')) {
      if (await lanRouter.handle(req, res, url)) return;
      throw new AppError(404, 'not found');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError(404, 'not found');
    if (await servePartyFiles(req, res, url, p, { lan: true })) return;
    throw new AppError(404, 'not found');
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

  const respond = (fn: typeof handle) => (req: IncomingMessage, res: ServerResponse) => {
    fn(req, res).catch((e: unknown) => {
      const status = e instanceof AppError ? e.status : 500;
      if (status >= 500) console.error('[server]', req.method, req.url, e);
      if (!res.headersSent) json(res, status, { error: errorMessage(e) || 'error', ...(e instanceof AppError && e.code ? { code: e.code } : {}) });
      else res.destroy();
    });
  };
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url || '/', 'http://x').pathname === '/party/ws') party.upgrade(req, socket, head);
    else socket.destroy();
  };

  // a party server has one listener (HTTPS with its own certificate, or HTTP behind a proxy that terminates TLS)
  // that serves the phones' routes only; the studio's listener does not exist there
  const server: http.Server | https.Server =
    cfg.mode === 'party'
      ? cfg.party.tls
        ? https.createServer({ cert: fs.readFileSync(cfg.party.tls.cert), key: fs.readFileSync(cfg.party.tls.key) }, respond(handleParty))
        : http.createServer(respond(handleParty))
      : http.createServer(respond(handle));
  server.requestTimeout = 0; // long uploads
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const hostName = (req.headers.host || '').replace(/:\d+$/, '');
    if (ctx.localOnly && !LOOPBACK_HOSTS.has(hostName)) return socket.destroy();
    upgrade(req, socket, head);
  });

  // a party server keeps no round for long: finished rounds are projects on disk, and a public server must not fill up
  let sweeper: NodeJS.Timeout | null = null;
  const sweep = () => {
    const cutoff = Date.now() - cfg.party.retentionHours * 3600_000;
    for (const p of projects.list({ template: false })) {
      if (p.mode === 'party' && new Date(p.updatedAt).getTime() < cutoff) {
        try {
          projects.remove(p.id);
        } catch (e) {
          console.error('[party] could not remove an old round', errorMessage(e));
        }
      }
    }
  };
  if (cfg.mode === 'party') {
    sweep();
    sweeper = setInterval(sweep, 3600_000);
    sweeper.unref();
  }

  const app: App = {
    server,
    lan: null,
    ctx,
    listen: async () => {
      mainPort = await new Promise<number>((resolve) => server.listen(cfg.port, cfg.host, () => resolve((server.address() as AddressInfo).port)));
      if (cfg.mode === 'studio' && cfg.party.port !== null) {
        try {
          const tls = await ensureCertificate(cfg.tlsDir, lanAddresses());
          const lan = https.createServer({ key: tls.key, cert: tls.cert }, respond(handleParty));
          lan.requestTimeout = 0;
          lan.on('upgrade', upgrade);
          lanPort = await new Promise<number>((resolve, reject) => {
            lan.once('error', reject);
            lan.listen(cfg.party.port ?? 0, cfg.party.host, () => resolve((lan.address() as AddressInfo).port));
          });
          app.lan = lan;
        } catch (e) {
          console.error(`[party] phones cannot join: ${errorMessage(e)}`);
        }
      }
      return mainPort;
    },
    close: async () => {
      if (sweeper) clearInterval(sweeper);
      party.close();
      const stop = (s: http.Server | https.Server | null) =>
        new Promise<void>((resolve) => {
          if (!s?.listening) return resolve();
          s.closeAllConnections();
          s.close(() => resolve());
        });
      await Promise.all([stop(server), stop(app.lan)]);
      closeDatabase(db);
    },
  };
  return app;
}
