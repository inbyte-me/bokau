---
name: verify-without-hardware
description: Verify Doblaje Studio changes silently with no microphone, audio interface, speakers or TV - which test commands to run, how the synthetic microphone works, and which tests must not be run unattended. Use before finishing any change, especially at night or on a muted machine.
---

# Verify without hardware

Everything in the normal gates is silent and needs no devices:
```
pnpm typecheck && pnpm lint && pnpm test      # types, Biome, unit + API (ffmpeg on generated media)
pnpm test:e2e                                 # builds the web app; headless Chrome with --mute-audio
node --test e2e/<file>.test.ts                # one browser suite (run pnpm build first)
```
- The microphone is synthetic: `injectFakeMic(page, fx('mic_speech.wav'), { channels: 2, only: 0 })` replaces
  `getUserMedia` with a looping WAV (optionally on one input of a 2-input interface).
- Sound is checked numerically from offline renders and exported files, never by listening.
- Fixtures are generated into `.cache/fixtures` on first use (needs ffmpeg and macOS `say`).
- e2e suites are CPU-heavy; run them one at a time (the script already does) and check `uptime` if they time out.

Never run unattended (they make sound or need a person): `pnpm test:live-output` (plays clicks through an output),
`pnpm test:live` (needs someone speaking into a real mic), `pnpm watch:hardware`. They skip themselves unless
`LIVE_MIC=1`, so a plain `node --test e2e/*.test.ts` is still silent.

Desktop: `node --test e2e/desktop.test.ts` launches Electron with a hidden window (`DOBLAJE_SMOKE=1`) and exits.

Report honestly: if a suite was skipped or failed, say which and why.
