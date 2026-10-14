#!/usr/bin/env node
// Server shell: everything lives in @doblaje/api; this file only starts it and reports where.
import { createApp } from '@doblaje/api';

const app = await createApp();
const port = await app.listen();
const { cfg, ai, ffmpegVersion } = app.ctx;
const s = ai.status();
console.log(
  cfg.mode === 'party'
    ? `
  Doblaje party server  →  ${cfg.party.publicUrl ?? `${cfg.party.tls ? 'https' : 'http'}://${cfg.host}:${port}`}/play/
  listening on ${cfg.host}:${port} ${cfg.party.tls ? '(HTTPS)' : '(HTTP: put a proxy with HTTPS in front, see docs/deployment.md)'}
  rooms: up to ${cfg.party.maxRooms}, ${cfg.party.createsPerHour} new per address per hour; media deleted ${cfg.party.emptyRoomMinutes} min after the last person leaves
  data: ${cfg.dataDir}
  ffmpeg: ${ffmpegVersion || 'NOT FOUND (install ffmpeg)'}
  phone app: ${cfg.playDir ?? 'not built — run `pnpm --filter @doblaje/play build`'}
  AI: ${s.configured ? `OpenRouter (${s.model}, spent $${s.spentUsd.toFixed(4)} of $${s.capUsd} cap)` : 'offline mode (no OPENROUTER_API_KEY)'}
  speech-to-text on the server: ${cfg.party.transcribe ? 'on' : 'off (PARTY_TRANSCRIBE=1 to turn on)'}
`
    : `
  Doblaje Studio  →  http://localhost:${port}
  party phones    →  ${app.lan ? `${app.ctx.partyBase()}/play/  (same Wi-Fi)` : 'off (PARTY_PORT=off, or the port is busy)'}
  data: ${cfg.dataDir}
  ffmpeg: ${ffmpegVersion || 'NOT FOUND (install ffmpeg)'}
  web: ${cfg.webDir ? cfg.webDir : 'not built — run `pnpm build`, or use `pnpm dev`'}
  AI: ${s.configured ? `OpenRouter (${s.model}, spent $${s.spentUsd.toFixed(4)} of $${s.capUsd} cap)` : 'offline mode (no OPENROUTER_API_KEY)'}
`,
);

const stop = async () => {
  await app.close();
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
