import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { AiConfig } from '@doblaje/ai';
import type { MediaConfig } from '@doblaje/media';
import { masterKeyFrom } from './library/vault.ts';

/** Repository root when running from source (apps and packages live under it). */
export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/**
 * `studio`: the desktop/laptop app (the studio and the TV on localhost, phones on the Wi-Fi through a second HTTPS
 * listener). `party`: a server for rooms only, meant to run behind a domain: one listener that serves the phone app, the
 * party API and the rooms' media, never the studio (see docs/deployment.md).
 */
export type ServerMode = 'studio' | 'party';

/** Accounts for the people who host rooms (see docs/accounts.md). `none`: anonymous rooms and an open library (the default). */
export interface AuthConfig {
  provider: 'none' | 'dev' | 'workos';
  workos: { apiKey: string; clientId: string; cookiePassword: string; redirectUri: string } | null;
}

export interface PartyConfig {
  /** HTTPS port phones join on (all interfaces); null: no party listener (phones cannot join from the Wi-Fi) */
  port: number | null;
  host: string;
  /** address printed in the QR code instead of https://<lan-ip>:<port> (a tunnel, a real domain) */
  publicUrl: string | null;
  /** reverse proxies in front of the server (their `x-forwarded-for` is believed for this many hops); 0: none */
  trustProxy: number;
  /** rooms open at once */
  maxRooms: number;
  /** rooms one address may open per hour */
  createsPerHour: number;
  /** party mode: minutes after the last person leaves a room before its media is deleted (the result can be downloaded until then) */
  emptyRoomMinutes: number;
  /** party mode: hours a round's project is kept before it is deleted (the library's clips are never touched) */
  retentionHours: number;
  /** party mode: serve HTTPS directly with this certificate (otherwise plain HTTP, for a proxy that terminates TLS) */
  tls: { cert: string; key: string } | null;
  /** the AI the party games use (suggested lines, directions, cards, the trailer's words, written games): a free model first, then a cheap one that tolerates crude players when the free one is out of requests or fails */
  aiModel: string;
  aiFallback: string;
  /** accounts: bytes of files one person may keep (their clips, recordings and sounds) */
  userQuotaBytes: number;
  /** accounts: the largest file one person may upload */
  userUploadBytes: number;
  /** accounts: what one person's AI use in the studio may cost, in USD (the key is the server's, shared) */
  userAiCapUsd: number;
  /** heavy jobs (ffmpeg, separation) the whole server runs at once */
  maxJobs: number;
  /** the server listens to takes (speech-to-text on the server) so a room needs no TV for it */
  transcribe: boolean;
}

export interface AppConfig {
  mode: ServerMode;
  /** projects (media files) and the database live here */
  dataDir: string;
  projectsDir: string;
  dbFile: string;
  /** override for bundled builds; defaults to packages/db/drizzle */
  migrationsDir?: string;
  /** cached speech models (Hugging Face proxy) */
  modelsDir: string;
  /** built web app (apps/web/dist); null serves only the API */
  webDir: string | null;
  /** built phone app (apps/play/dist), served at /play/ */
  playDir: string | null;
  /** background audio library files */
  soundsDir: string;
  /** the party listener's self-signed certificate */
  tlsDir: string;
  party: PartyConfig;
  auth: AuthConfig;
  /** the master key that wraps each library clip's data key (null: the library is not encrypted) */
  libraryKey: Buffer | null;
  /** browser builds of transformers.js and onnxruntime-web, served to the speech worker */
  vendorDirs: { transformers: string; ort: string };
  host: string;
  port: number;
  maxUploadBytes: number;
  media: MediaConfig;
  ai: AiConfig;
}

export type ConfigOverrides = Partial<Omit<AppConfig, 'media' | 'ai' | 'party' | 'auth'>> & {
  auth?: Partial<AuthConfig>;
  media?: Partial<MediaConfig>;
  party?: Partial<PartyConfig>;
  ai?: Partial<AiConfig>;
  /** file with KEY=value lines; real environment variables win */
  envFile?: string | null;
  toolsDir?: string;
};

/** Locate the speech libraries in node_modules (overridden by bundled builds). */
export function defaultVendorDirs(): AppConfig['vendorDirs'] {
  const entry = import.meta.resolve('@huggingface/transformers');
  return { transformers: path.dirname(new URL(entry).pathname), ort: path.dirname(createRequire(entry).resolve('onnxruntime-web')) };
}

/**
 * Build the configuration from overrides, then environment variables, then defaults.
 * `.env` is read with Node's built-in loader (`process.loadEnvFile`).
 */
export function loadConfig(o: ConfigOverrides = {}): AppConfig {
  const envFile = o.envFile === undefined ? path.join(REPO_ROOT, '.env') : o.envFile;
  if (envFile && fs.existsSync(envFile)) {
    const before = { ...process.env };
    process.loadEnvFile(envFile);
    for (const [k, v] of Object.entries(before)) process.env[k] = v; // real env vars win over .env
  }
  const env = process.env;
  const dataDir = o.dataDir || env.DOBLAJE_DATA || path.join(REPO_ROOT, 'data');
  const webDist = path.join(REPO_ROOT, 'apps', 'web', 'dist');
  const playDist = path.join(REPO_ROOT, 'apps', 'play', 'dist');
  const partyPort = env.PARTY_PORT === 'off' ? null : Number(env.PARTY_PORT ?? 5178);
  const mode: ServerMode = (o.mode ?? env.DOBLAJE_MODE) === 'party' ? 'party' : 'studio';
  const number = (v: string | undefined, fallback: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);
  return {
    mode,
    dataDir,
    projectsDir: o.projectsDir || path.join(dataDir, 'projects'),
    dbFile: o.dbFile || path.join(dataDir, 'doblaje.db'),
    migrationsDir: o.migrationsDir,
    modelsDir: o.modelsDir || env.DOBLAJE_MODELS || path.join(REPO_ROOT, 'models'),
    webDir: o.webDir !== undefined ? o.webDir : fs.existsSync(webDist) ? webDist : null,
    playDir: o.playDir !== undefined ? o.playDir : fs.existsSync(playDist) ? playDist : null,
    soundsDir: o.soundsDir || path.join(dataDir, 'sounds'),
    tlsDir: o.tlsDir || path.join(dataDir, 'tls'),
    party: {
      port: partyPort,
      host: env.PARTY_HOST || '0.0.0.0',
      publicUrl: env.PARTY_URL || null,
      trustProxy: number(env.TRUST_PROXY, 0),
      maxRooms: number(env.PARTY_MAX_ROOMS, 20),
      createsPerHour: number(env.PARTY_CREATES_PER_HOUR, 12),
      emptyRoomMinutes: number(env.PARTY_EMPTY_ROOM_MINUTES, 5),
      retentionHours: number(env.PARTY_RETENTION_HOURS, 24),
      tls: env.TLS_CERT && env.TLS_KEY ? { cert: env.TLS_CERT, key: env.TLS_KEY } : null,
      aiModel: env.PARTY_AI_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free',
      aiFallback: env.PARTY_AI_FALLBACK || 'deepseek/deepseek-v4.1-flash',
      userQuotaBytes: number(env.USER_QUOTA_MB, 3000) * 1024 ** 2,
      userUploadBytes: number(env.USER_UPLOAD_MB, 500) * 1024 ** 2,
      userAiCapUsd: number(env.USER_AI_CAP_USD, 0.1),
      maxJobs: number(env.MAX_JOBS, 2),
      transcribe: env.PARTY_TRANSCRIBE === '1',
      ...o.party,
    },
    libraryKey: o.libraryKey !== undefined ? o.libraryKey : masterKeyFrom({ key: env.LIBRARY_KEY, file: env.LIBRARY_KEY_FILE }),
    auth: {
      provider: env.AUTH_PROVIDER === 'workos' || env.AUTH_PROVIDER === 'dev' ? env.AUTH_PROVIDER : 'none',
      workos:
        env.WORKOS_API_KEY && env.WORKOS_CLIENT_ID
          ? {
              apiKey: env.WORKOS_API_KEY,
              clientId: env.WORKOS_CLIENT_ID,
              cookiePassword: env.WORKOS_COOKIE_PASSWORD ?? '',
              redirectUri: env.WORKOS_REDIRECT_URI || `${(env.PARTY_URL ?? 'http://localhost:5177').replace(/\/$/, '')}/auth/callback`,
            }
          : null,
      ...o.auth,
    },
    vendorDirs: o.vendorDirs || defaultVendorDirs(),
    host: o.host || env.HOST || (mode === 'party' ? '0.0.0.0' : '127.0.0.1'),
    port: Number(o.port ?? env.PORT ?? 5177),
    maxUploadBytes: o.maxUploadBytes ?? 8 * 1024 ** 3,
    media: {
      ffmpeg: env.FFMPEG || 'ffmpeg',
      ffprobe: env.FFPROBE || 'ffprobe',
      toolsDir: o.toolsDir || path.join(REPO_ROOT, 'tools'),
      ...o.media,
    },
    ai: {
      apiKey: () => process.env.OPENROUTER_API_KEY || '',
      openrouterBase: env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1',
      // The OpenRouter key itself is capped at 5 USD; stop earlier.
      spendCapUsd: Number(env.SPEND_CAP_USD ?? 3.5),
      defaultModel: env.OPENROUTER_MODEL || 'qwen/qwen3.7-flash',
      fallbackModel: env.OPENROUTER_FALLBACK_MODEL || 'anthropic/claude-haiku-5.5',
      ...o.ai,
    },
  };
}
