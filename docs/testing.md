# Testing

All tests use Node's built-in runner (`node --test`) and run the TypeScript sources directly.

| Layer | Where | Command | What it proves |
|---|---|---|---|
| Unit | `packages/{core,audio,db}/test`, `apps/web/test` | `pnpm test` | pure logic: syllables, SRT, clustering, pitch shifter (numerically), latency maths, repositories, i18n coverage |
| API | `packages/api/test` | `pnpm test` | the real backend with ffmpeg on generated media: ingest, stems, export (stream copy vs render), podcast loudness/chapters, AI (mocked OpenRouter, spend cap) |
| End-to-end | `e2e/` | `pnpm test:e2e` | built web app in headless Chrome against the real backend: offline-render audio analysis, recording, punch/loop, marks, party games, podcast recording, viewport fit, sizing contracts of every region at 8 window sizes, right-click menus, Spanish UI, desktop shell smoke |
| Live hardware | `e2e/live-*.test.ts` | `pnpm test:live`, `pnpm test:live-output`, `pnpm watch:hardware` | a real mic / interface / output device (skipped unless `LIVE_MIC=1`) |

## Fixtures
`packages/testkit/src/fixtures.ts` generates deterministic media into `.cache/fixtures` (git-ignored) with ffmpeg
and macOS `say`: clips in several containers and layouts (stereo, 5.1, mono, silent, portrait, 1080p), a three-voice
dialogue with ground truth, MediaRecorder-style WebM without duration, subtitle files. Generated on first use;
`pnpm fixtures --force` regenerates.

## Silent by design
Nothing in `pnpm test` / `pnpm test:e2e` makes a sound or needs hardware:
* Chrome starts headless with `--mute-audio` (`launch()` in `packages/testkit/src/browser.ts`).
* `injectFakeMic(page, wav, { channels, only })` replaces `getUserMedia` with a stream looping a WAV, optionally on
  one input of a 2-channel "interface" only, like budget interfaces.
* Audio correctness is measured from the offline render (levels, ducking depth, pitch, mask curves), not by ear.

`audible: true` / `realMic: true` exist for the live tests only. `test:live-output` plays clicks through the chosen
output to measure latency: only run it when that is acceptable.

## Writing tests
* Backend behaviour: start a throw-away server with `startApp()` from `@doblaje/testkit` (temp data folder, fresh
  database, fake AI key), drive it with `app.api()`, wait for jobs with `app.waitJob()`.
* Browser behaviour: `launch()` + `injectFakeMic()` + `page.goto(app.base + '/#/p/<id>')`. Inside `page.evaluate`
  the app is reachable as `window.__app`; package modules as `window.__testing.audio()` / `.speech()`.
* Mock OpenRouter with a local HTTP server and `startApp({ ai: { openrouterBase } })`; tests never spend money.
* Keep e2e tests independent of timing where possible: poll with `until(fn)` instead of fixed sleeps.

e2e files run one at a time (`--test-concurrency=1`); they are CPU-heavy (ffmpeg, Chrome, WASM models).
