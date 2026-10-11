import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env loader (no dependency). Real env vars win over .env. */
export function loadEnv(file = path.join(ROOT, '.env')) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (!m || line.trim().startsWith('#')) continue;
      const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch { /* no .env is fine */ }
}

export function makeConfig(overrides = {}) {
  loadEnv();
  const dataDir = overrides.dataDir || process.env.DOBLAJE_DATA || path.join(ROOT, 'data');
  return {
    root: ROOT,
    dataDir,
    projectsDir: path.join(dataDir, 'projects'),
    modelsDir: overrides.modelsDir || path.join(ROOT, 'models'),
    publicDir: path.join(ROOT, 'public'),
    sharedDir: path.join(ROOT, 'shared'),
    host: overrides.host || process.env.HOST || '127.0.0.1',
    port: Number(overrides.port ?? process.env.PORT ?? 5177),
    ffmpeg: process.env.FFMPEG || 'ffmpeg',
    ffprobe: process.env.FFPROBE || 'ffprobe',
    openrouterBase: overrides.openrouterBase || process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1',
    // Hard local spend cap (USD). The OpenRouter key itself is capped at 5 USD; we stop earlier.
    spendCapUsd: Number(overrides.spendCapUsd ?? process.env.SPEND_CAP_USD ?? 3.5),
    defaultModel: process.env.OPENROUTER_MODEL || 'qwen/qwen3.7-flash',
    fallbackModel: process.env.OPENROUTER_FALLBACK_MODEL || 'anthropic/claude-haiku-5.5',
    maxUploadBytes: 8 * 1024 ** 3,
  };
}
