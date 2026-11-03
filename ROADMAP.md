# Roadmap

Open work, taken from the "Honest limits" in the README and the notes in `docs/`.

## Audio and voices
- Stem separation: the fast mode is signal processing, so mono clips cannot be split and busy stereo mixes leak. Make the neural mode (`pnpm setup:separation`) easier to set up and usable on more machines. Today `onnxruntime-node` has no Intel-Mac build, so everything ML runs in WASM in the browser.
- Voice identification separates turns, not overlapping voices: handle two characters talking at once, and tell apart similar voices (children, for instance).
- Auto lip-flaps follow the dialogue's loudness, not the actor's face; silent clips need manual marks with **M**.
- Speech recognition: recordings made far from the mic are transcribed poorly; the syllable counter is heuristic (EN/ES/FR) and could cover more languages.

## Party games (`docs/party.md`)
- Make any role replaceable by the AI, performers included: modes declare their roles and the room fills the empty ones (the "next step" in the party design)
- More game modes on the existing mode interface (`pickSlice`, `turnsOf`, `blindScript`, `trailerMoments`)

## Platform
- Replace the LAN-only party URL with a tunnel or real domain (`PARTY_URL`, ADR 0008)
- Hardware coverage beyond the budget mic, USB interface, headphones and TV setup described in `docs/hardware.md`
