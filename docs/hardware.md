# Hardware: budget mic, USB interface, headphones, TV

* **Mic + interface (USB):** pick the interface in *Voice → Input device*. Cheap 2-input interfaces often carry the mic
  on **input 1 only**: *Interface channel → Auto* detects that and uses only the live input (or choose *Input 1 / Left*).
  Capture is raw (no echo cancellation, noise suppression or AGC) for clean dry takes.
* **Mic check** (2 s quiet + 3 s speech) reports noise floor, speech level, clipping and SNR, and suggests a trim. Set
  gain on the interface knob first, trim in the app second. Turn on the track's **Mic fix** (rumble filter + gentle
  leveling) and use **Denoise this clip** for budget mics.
* **Headphones vs TV speakers:** *Recording setup*. On speakers the mic would hear the film, so the original is muted
  while recording (picture, cues and countdown still run). With headphones you can hear the original, the music bed
  or the ghost guide while recording.
* **Latency:** *Auto-calibrate* plays clicks and listens for them (hold the headphones to the mic, or use speakers).
  USB interfaces ≈ 15–40 ms, Bluetooth 150–300 ms (avoid for recording). If the TV lags the picture, use
  *Mix → Picture delay*.
* **TV:** put the browser (or the desktop app) on the TV over HDMI and press **F** for TV mode. A presenter clicker or
  any keyboard works from the sofa.

## Checking real hardware
`pnpm doctor` lists the inputs macOS can see. With the device plugged in:
```
pnpm test:live                                   # LIVE_DEVICE="USB Audio CODEC" to pick one; needs someone talking
LIVE_OUTPUT="TV" pnpm test:live-output           # plays audible clicks through that output
pnpm watch:hardware                              # waits for a new device and runs the matching test
```
These are never part of `pnpm test` / `pnpm test:e2e`.
