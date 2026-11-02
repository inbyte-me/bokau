# Doblaje Studio — Voice-Over & Parody Studio

A local dubbing / parody / party-game studio for video clips. Import a clip, silence the original actors but keep the music and sound effects, and record your own voice over it — either as a **serious dubbing workstation** (rhythm band, lip-flap markers, ghost guide, syllable-matched translation) or as **party games for the living-room TV** (Bad Lip Reading, Telenovela, Blind Dubbing, Genre Swapper).

Built for a modest setup: a budget mic + USB audio interface, headphones, and a TV. Everything heavy runs on the CPU of the machine it's installed on; AI text features use OpenRouter with a cheap default model and a hard local spend cap.

```
corepack enable pnpm   # once
pnpm install
pnpm start             # builds the web app and serves it → http://localhost:5177   (use Chrome)
pnpm desktop           # or: the same app as a desktop window (Electron)
pnpm doctor            # checks Node, ffmpeg, AI key, and which audio inputs macOS can see
```

Needs: Node 24.11+ (`nvm use` reads `.nvmrc`), `ffmpeg` on the PATH, Chrome for the browser version (Safari/Firefox lack some Web Audio features; the desktop app brings its own Chromium).
Copy `.env.example` to `.env` (git-ignored) and set `OPENROUTER_API_KEY` to enable AI. Without it everything works; translation is disabled and party games use an offline silly-line generator.

Developing: see [AGENTS.md](AGENTS.md) and [docs/](docs/README.md). `pnpm dev` runs the API and Vite with hot reload.

## Clip library and party karaoke
Add videos to the **clip library** and prepare them once: separate the dialogue, generate subtitles, find the characters and fix who says what. A clip is never recorded on; from it you start as many **dubbing**, **party** or **podcast** projects as you like (media is shared on disk, the prepared work is copied).
At a party, **Party: pick a clip** shows the library on the TV: pick a scene, pick the character(s) you play, and those voices go silent while the rest of the scene plays and your lines light up karaoke-style. Record, watch the reveal, *Next player*.

## The three modes

Choose when creating a project.

### Pro Dub Studio
Import a clip and keep *Prepare automatically* on: the dialogue is separated from the music, subtitles are generated
and every speaker gets their own lane. Then pick your devices from the chip in the top bar and record.

| What | How |
|---|---|
| Multi-track timeline | video thumbnails, original-audio waveform, cue lane, lip-flap lane, any number of voice tracks; zoom, drag, split, nudge |
| **Rhythm band** ("bande rythmée") | text scrolls right→left to the red line; each word is as wide as its syllables last; **M/B/P letters (lips closed) are pink**; mouth-open bars underneath |
| Lip-flap markers | auto from the dialogue, or hold **M** while playing, or draw in the lane |
| Recording | 3-2-1-BEEP count-in, punch-in over a range, loop-record a cue (one take per pass), take list with "Use" (comping), latency compensation + per-track micro-nudge |
| Ghost audio guide | original dialogue in one ear at low level (headphones) — never part of the export |
| Translation assistant | OpenRouter; each line is fitted to the original **syllable count** and to **where the lips close** (M/B/P); one-click apply, one-click undo |
| Subtitles | import `.srt`/`.vtt`, auto-transcribe on-device (Whisper), export `.srt` / `.json` with timings + character names |

### Podcast
Record **audio and video** from your camera and microphone (or audio only). The recording is streamed to disk every second, so a crash or a long session can't lose or bloat it. Add **chapters** while recording (press **M**), then in the review screen: trim with draggable handles (**I** / **O**), edit chapters, transcribe on-device, and export **MP3 / M4A (with real chapter marks) / WAV / MP4 / WebM** with optional voice clean-up (rumble filter, noise reduction, gentle compression) and **two-pass loudness normalisation to −16 LUFS**; the measured result is shown after export. A `.srt` transcript and a chapter list come out next to the audio.

### Parody & Party (TV mode — press **F**)
Big UI, karaoke lyrics, countdown, "Drama-o-meter". Everyone shares one mic.
* **Bad Lip Reading** — the AI writes absurd lines that match the syllable count (and, optionally, the *sounds*) of what the mouths say. You read them karaoke-style.
* **Telenovela Overdrive** — transcribes the scene and rewrites each line as a soap-opera meltdown, with acting directions and a drama score.
* **Blind Dubbing Challenge** — 4–6 segments; each player improvises over a *silent* segment, seeing only the **last second** of the previous player's performance. Chaotic reveal at the end, every player on their own track with a silly voice effect.
* **Genre Swapper** — Noir, Pirate, Bad Corporate Speak, 80s Action.

## Voices: dub one character by silencing it
*Voices → Prepare all* (or *Identify voices*) finds the distinct speakers on the separated dialogue track (a speaker-embedding model running in the browser), gives each speaker **their own lane** in the timeline, and gives each character an **On / Off / Solo**. Turn **Character A** off and the original plays without that voice (the music, effects and the other characters stay) while you record your own over it. Rename a character and the cue labels follow. If the automatic count is wrong, pick the number of voices; to fix who says what, split a passage at any point (right-click → *Split passage here*, or select it and press **S** at the playhead) and right-click each piece to give it to the right character; subtitle cues split the same way. Muting is by speech turn: where two characters talk at the same moment, the passage belongs to one of them.

## Stem separation
* **Fast** (instant): 5.1/7.1 uses the clean centre channel; stereo uses centre-channel extraction.
* **Best quality (neural)**: Demucs `htdemucs` on the CPU, about as long as the clip (a 2-minute clip ≈ 2 minutes on an Intel i7). This is the one that works on **mono** mixes such as most cartoons. One-time install into `./tools`: `pnpm setup:separation` (~1 GB, nothing outside the folder is touched).

## Voice effects and mixing
Walkie-talkie (band-pass 300 Hz–3.4 kHz + saturation + squelch bursts), Monster (−5…−12 st + warmth), Helium (+7…+12 st **with formant preservation**), Ghost (big reverb, high-frequency roll-off). Pitch shifting is a phase-vocoder written for this app (`packages/audio/src/pitch-core.ts`), verified numerically by the tests.
**Auto-ducking**: the music dips by a set amount (default −12 dB) *just before* you speak and recovers after. **Stem separation** splits the clip into *Dialogue* and *Music + SFX* (see limits below).

## Marks and keyboard
`⌘/Ctrl + 1…9` sets a mark at the playhead, `⌥/Option + 1…9` jumps to it — and keeps whatever the transport was doing: paused stays paused, playing keeps playing, **recording keeps recording** (the take is split at the jump and each part lands at the right place; recording over earlier material replaces it, the old audio stays in the Takes list). If your browser swallows `⌘+number` (tab switching), `Shift + number` also sets. Press **?** in the studio for the full list.

## Export
* **Quick share** — MP4 (H.264/AAC) or WebM (VP9/Opus), optional target size (8 / 10 / 16 / 25 MB), loudness normalisation.
* **Fast export** — if you don't burn subtitles, crop or watermark, the original video stream is **copied untouched** and only the new audio is muxed in (near-instant).
* **Full render** — burned-in subtitles, text watermark, **9:16 vertical** crop with a focus slider.
* **Studio archive** — `video_mixed.mp4` + `stem_original_music_sfx.wav` + `stem_user_voice_dry.wav` (raw recordings placed on the timeline) + `stem_user_voice_wet.wav` (with effects) + `.srt` + `.json`.

The mix is rendered **in the browser with the same audio graph used for preview**, so what you hear is what you export; the server only muxes video. Files land in `data/projects/<id>/exports/` (desktop: the app's user-data folder).

## Your hardware
* **Mic + interface (USB):** pick the interface in *Voice → Input device*. Cheap 2-input interfaces often carry the mic on **input 1 only** — choose *Input 1 / Left* in *Interface channel*. Capture is raw (no echo-cancel/noise-suppress/AGC) for clean dry takes.
* **Run *Mic check*** (2 s quiet + 3 s speech): it reports noise floor, speech level, clipping, SNR and suggests a trim. Set gain on the interface knob first, trim here second. Turn on the track's **Mic fix** (rumble filter + gentle leveling) and use **Denoise this clip** (FFT denoise on the server) for budget mics.
* **Headphones vs TV speakers:** *Recording setup* → choose which. On TV speakers the mic would hear the film, so the original audio is muted while recording (you still see picture, cues and countdown). With headphones you can hear the original, the music bed or the ghost guide while recording.
* **Latency:** *Auto-calibrate* plays chirps and listens for them (put headphones next to the mic, or use speakers) to measure the round trip and shift recordings by it. USB interfaces ≈ 15–40 ms, Bluetooth 150–300 ms (avoid for recording). If the TV lags the picture, use *Mix → Picture delay*.
* **TV:** put the browser on the TV (HDMI), press **F**. A presenter clicker or any keyboard works from the sofa.

## AI cost control
* Default model `qwen/qwen3.7-flash` (≈ $0.03 / $0.13 per million tokens → a typical call costs ≈ **$0.00004**). Choose others in the AI tab: Qwen3-235B, Ling, Claude Haiku 5.5 (most precise syllables), Gemini Flash Lite. Only a short allow-list of cheap models is accepted. Party games use their own pair (a free model first, a cheap one that tolerates crude players as fallback: `PARTY_AI_MODEL`, `PARTY_AI_FALLBACK`; see docs/deployment.md).
* A **local ledger** (the `ai_calls` table in `data/doblaje.db`) adds up the real cost OpenRouter reports for every call and **refuses further calls at $3.50** (`SPEND_CAP_USD`), below the key's own limit. After that, party games fall back to the offline generator.
* A short repair pass re-asks only the lines whose syllable count is off.
* The key never leaves the server; the server only listens on localhost and rejects foreign `Host`/`Origin` headers.

## Honest limits
* **Fast stem separation** is signal processing, not a neural network, so busy stereo mixes with centred music leak and **mono clips can't be split that way**: use *Best quality (neural)* (needs `pnpm setup:separation`).
* **Voice identification** separates *turns*, not overlapping voices: when two characters talk at once the passage is assigned to one of them. It works best on clean dialogue and may merge two similar voices (children, say); use the *number of voices* selector to correct it.
* **Auto lip-flaps** follow the dialogue's loudness, not the actor's face (no computer vision). For silent clips tap them with **M**.
* **Speech recognition** is Whisper (tiny/base/small, quantised ONNX) in the browser: `base` is the default (~1× real time on this i7). Recordings made far from the mic are transcribed poorly — the Mic check tells you when that is the case. Models download once into `models/`.
* `onnxruntime-node` has no Intel-Mac build, so everything ML runs in WASM in the browser.
* The syllable counter is heuristic (EN/ES/FR).

## Layout
```
apps/      server (HTTP shell) · web (Svelte/Vite frontend shell) · desktop (Electron shell) · play (phone client for party rooms, served at /play/)
packages/  core (shared domain) · db (SQLite + Drizzle) · media (ffmpeg) · ai (OpenRouter) · api (HTTP app)
           audio (Web Audio engine) · speech (Whisper, voice id) · party (party-room state machine and wire protocol)
           party-ui (screens shared by the TV and phones) · ui (DOM helper, icons, i18n) · testkit
e2e/       browser tests      docs/   architecture, data, API, audio engine, ADRs
data/      projects + doblaje.db (git-ignored)      models/   cached speech models (git-ignored)
```
Details: [docs/architecture.md](docs/architecture.md).

## Tests
`pnpm test` (unit + API, ffmpeg-based), `pnpm test:e2e` (headless, muted Chrome with a synthetic microphone: offline-render audio analysis, recording, punch/loop, marks, export, party games, podcast, Spanish UI, desktop shell), `pnpm test:live` (real microphone, needs a person talking nearby). See [docs/testing.md](docs/testing.md).

## License

[MIT](LICENSE)
