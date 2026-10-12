#!/usr/bin/env node
// Server shell: everything lives in @doblaje/api; this file only starts it and reports where.
import { createApp } from '@doblaje/api';

const app = await createApp();
const port = await app.listen();
const { cfg, ai, ffmpegVersion } = app.ctx;
const s = ai.status();
console.log(`
  Doblaje Studio  →  http://localhost:${port}
  data: ${cfg.dataDir}
  ffmpeg: ${ffmpegVersion || 'NOT FOUND (install ffmpeg)'}
  web: ${cfg.webDir ? cfg.webDir : 'not built — run `pnpm build`, or use `pnpm dev`'}
  AI: ${s.configured ? `OpenRouter (${s.model}, spent $${s.spentUsd.toFixed(4)} of $${s.capUsd} cap)` : 'offline mode (no OPENROUTER_API_KEY)'}
`);

const stop = async () => {
  await app.close();
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
