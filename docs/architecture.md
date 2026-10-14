# Architecture

## Shells and packages
Three thin **shells** compose shared **packages**:

```
             ┌──────────── apps/server ─────────────┐     ┌──────── apps/desktop (Electron) ────────┐
             │  createApp().listen(:5177)           │     │  createApp().listen(127.0.0.1:random)    │
             └──────────────────┬───────────────────┘     │  BrowserWindow → http://127.0.0.1:port   │
                                │                         └───────────────────┬──────────────────────┘
                                ▼                                             ▼
   @doblaje/api ── router, routes, jobs, static + media serving, Host/Origin guard, party hub
      │            (+ HTTPS party listener on the LAN for phones: /play, player routes, /party/ws)
      ├── @doblaje/db     SQLite (node:sqlite) + Drizzle: projects, ai_calls, meta
      ├── @doblaje/media  ffmpeg: ingest, stems (centre-cut / 5.1 / Demucs), export, podcast
      └── @doblaje/ai     OpenRouter client + spend ledger, prompts, offline generators
                                ▲  HTTP (same origin)
   apps/web (Vite + Svelte) ── router, store (undo/autosave), feature screens, party room (TV)
   apps/play (Vite + Svelte) ── phone client for party rooms (served at /play/)
      ├── @doblaje/audio  Web Audio engine: transport, mix graph, FX, worklets, mic, recording
      ├── @doblaje/speech Whisper + voice embeddings in a worker (transformers.js, WASM)
      ├── @doblaje/party  room state machine, casting, protocol, PartyClient (also used by the server)
      └── @doblaje/ui     Svelte components, tokens, icons, i18n, menus
   @doblaje/core ── shared by all: project model + types, HTTP contracts, SRT, syllables, diarization
```

`apps/server` and `apps/desktop` contain no business logic: everything they serve is `createApp()` from
`@doblaje/api`, configured differently (data folder, port, asset paths). The desktop shell embeds the same backend
in Electron's main process, so the web app talks HTTP to localhost in both cases and needs no Electron-specific code.

## Why the work is split this way
* **Heavy, file-based work runs on the server** (ffmpeg, Demucs). It is CPU-bound, needs the original files, and
  reports progress as a polled job.
* **Everything you hear runs in the browser** with Web Audio: preview and export use the same graph
  (`packages/audio/src/mixgraph.ts`, rendered offline with `OfflineAudioContext` for export), so the export
  sounds exactly like the preview. The server only muxes the rendered WAV with the video.
* **ML runs in the browser** (WASM): `onnxruntime-node` has no Intel-Mac build, and the browser already has the audio.
  The server proxies and caches the model files (`/hf/…`) so it works offline after the first download.

## A recording, end to end
1. `RecordSession.start()` schedules a count-in on the AudioContext clock, starts capture in an AudioWorklet a
   moment before GO and starts playback anchored to GO.
2. On stop, samples are split per segment (a jump to a mark starts a new one), shifted by the measured
   round-trip latency, added to the project as a take + clip (undoable) and uploaded as WAV in the background.
3. The store autosaves the project document (`PUT /api/projects/:id`) 700 ms after the last edit.
4. Export: the browser renders `mix.wav` (and stems for the archive profile) with the mix graph, uploads them,
   then starts an export job; ffmpeg stream-copies the original video when nothing forces a re-encode.

## Data
Projects live in SQLite (`data/doblaje.db`); media files (source, proxy, stems, takes, exports) live in
`data/projects/<id>/`. See [data.md](data.md).

## Cross-cutting rules
* Strict TypeScript everywhere; Node runs `.ts` source directly ([ADR 0002](adr/0002-typescript-without-a-build-step.md)).
* Localhost only, same-origin only; the AI key never leaves the server ([api.md](api.md#security)).
* All AI spend goes through one ledger with a hard local cap.
