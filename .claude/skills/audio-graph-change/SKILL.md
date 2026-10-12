---
name: audio-graph-change
description: Change how Doblaje Studio sounds - mixing, ducking, voice masking, effects, ghost guide, export stems - in packages/audio. Use for any change to buildMix, fx, duck, render or the worklets, so preview and export stay identical and the change is verified without listening.
---

# Change the audio graph

Invariant: **one graph**. `buildMix()` in `packages/audio/src/mixgraph.ts` builds playback for the live
`AudioContext` and for the `OfflineAudioContext` used by export (`render.ts`). Never add a preview-only or
export-only path for something the user hears in both.

1. Make the change in `mixgraph.ts` / `fx.ts` / `duck.ts`. Nodes must work in both context types: no
   `MediaElementSource`, no reliance on `ctx.currentTime` advancing (offline renders run faster than real time);
   schedule with the `when` parameter. For a new AudioWorklet, import it as `./x.ts?worker&url` and load it in
   `ensureWorklets()`.
2. Pure DSP (filters you compute, curves, pitch) goes in a plain function or class with no Web Audio dependency, so it
   can be unit-tested in Node (`packages/audio/test`, see `pitch.test.ts`).
3. Verify by measurement, not by ear (works on a muted laptop at night): in `e2e/audio.test.ts`, render offline in the
   page and assert levels/spectrum:
   ```ts
   const r = await page.evaluate(async () => {
     const { renderStem } = await window.__testing.audio();
     const buf = await renderStem(window.__app.project, window.__app.engine.assets, 'mix', { duration: 4 });
     // compute RMS / peak / band energy of buf.getChannelData(0) here and return numbers
   });
   ```
4. If the change affects what export contains, extend `packages/api/test/export.test.ts` (it checks muxed output
   levels with `meanDb()`).
5. `pnpm typecheck && pnpm test && pnpm test:e2e`. Update `docs/audio-engine.md`.

Live-only behaviour (mic monitoring, live ducking from the mic) belongs in `mic.ts` / `session.ts`; keep it out of
the export path explicitly (as the ghost guide is).
