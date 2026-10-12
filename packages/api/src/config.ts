import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { AiConfig } from '@doblaje/ai';
import type { MediaConfig } from '@doblaje/media';

/** Repository root when running from source (apps and packages live under it). */
export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

export interface AppConfig {
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
  /** browser builds of transformers.js and onnxruntime-web, served to the speech worker */
  vendorDirs: { transformers: string; ort: string };
  host: string;
  port: number;
  maxUploadBytes: number;
  media: MediaConfig;
  ai: AiConfig;
}

export type ConfigOverrides = Partial<Omit<AppConfig, 'media' | 'ai'>> & {
  media?: Partial<MediaConfig>;
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
  return {
    dataDir,
    projectsDir: o.projectsDir || path.join(dataDir, 'projects'),
    dbFile: o.dbFile || path.join(dataDir, 'doblaje.db'),
    migrationsDir: o.migrationsDir,
    modelsDir: o.modelsDir || env.DOBLAJE_MODELS || path.join(REPO_ROOT, 'models'),
    webDir: o.webDir !== undefined ? o.webDir : fs.existsSync(webDist) ? webDist : null,
    vendorDirs: o.vendorDirs || defaultVendorDirs(),
    host: o.host || env.HOST || '127.0.0.1',
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
