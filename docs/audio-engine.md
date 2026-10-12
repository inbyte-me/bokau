# Audio engine (`@doblaje/audio`)

## Clock and transport
`Engine` owns one `AudioContext` (48 kHz, interactive latency). Its clock is the master: the `<video>` element is
muted and slaved to it (seek on > 150 ms drift, playback-rate nudges below that), corrected for the output latency
and an optional picture delay for laggy TVs. `engine.time` is derived from `ctx.currentTime`, never from the video.

## One mix graph
`buildMix(ctx, project, assets, opts)` builds the whole graph for **any** `BaseAudioContext`:
* original audio: full mix, or music bed + dialogue stem as two layers when voices are muted (a gain curve from
  `maskCurve()` silences the muted speakers' turns), with look-ahead ducking under the user's voice and a live-duck
  node driven by the mic while recording;
* the ghost guide (original dialogue, one ear, headphones only, bypasses the limiter, never exported);
* voice tracks: clip → mic fix → FX → volume/pan → voice bus; clips scheduled with micro-fades and FX latency
  compensation;
* a transparent safety limiter on the master.

Preview calls it on the live context; export calls it on an `OfflineAudioContext` (`renderStem()`), so what you hear
is what you export. **Change the mix only here**, and cover the change with an offline-render assertion in
`e2e/audio.test.ts`.

## Recording (`RecordSession`)
Count-in beeps scheduled on the audio clock; capture starts ~80 ms before GO in the capture worklet, which reports
the exact frame of its first sample; playback is anchored to GO. Takes are cut per segment (jumping to a mark while
recording starts a new segment), shifted by `latencyMs`, placed with `carveClips()` (recording over material
replaces it; old takes stay listed) and uploaded in the background (`flushUploads()` before export).

## Latency
`calibrateLatency()` plays a train of chirps and cross-correlates the capture; a delay is accepted only if most
chirps agree within ±4 ms and it is at least 3 ms (shorter is cross-talk). Typical: USB interfaces 15–40 ms,
Bluetooth 150–300 ms.

## Effects and worklets
`createFx()` presets: walkie-talkie (4-pole band-pass, saturation, squelch bursts), monster and helium (phase-vocoder
pitch shift in an AudioWorklet, with cepstral formant preservation for helium), ghost (synthetic IR reverb).
`pitch-core.ts` is plain TypeScript, unit-tested numerically in Node. Worklets are bundled by Vite as separate ES
modules (`?worker&url` imports).

## Mic
Raw capture (no echo cancellation, noise suppression or AGC) for dry takes; channel pick for 2-input interfaces,
including an automatic mode that drops a dead input; trim gain; meters; guided mic check with advice
(`analyzeCheck()`).
