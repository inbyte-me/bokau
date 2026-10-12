# 0004: Electron desktop shell embedding the HTTP backend

**Context.** A "native" app should open with a double-click, keep data in the OS user-data folder and get
microphone/camera permission like other apps. The product depends on Chromium Web Audio features (AudioWorklet,
`setSinkId`, MediaRecorder) and on Node for ffmpeg and SQLite.

**Decision.** Electron (Chromium + Node in one runtime). The main process runs the same `createApp()` as the server
shell on a random loopback port and loads it in a `BrowserWindow` (context isolation, sandbox, no Node in the page,
navigation locked to our origin, media permissions granted only to our origin). The web app is unchanged and still
talks HTTP. A `DOBLAJE_SMOKE=1` mode starts hidden, verifies the backend and UI, and exits (used by `e2e/desktop.test.ts`).

**Alternatives.** Tauri (system WebView: WebKit on macOS lacks parts of the Web Audio and media APIs we use, and the
backend would need a Node sidecar anyway). Custom protocol instead of loopback HTTP (would need Range support,
streaming uploads and a second code path for media).

**Consequences.** A large download (~100 MB) but identical behaviour in browser and desktop, one backend code path,
and native modules limited to `@napi-rs/canvas` (N-API, ABI-stable). ffmpeg is not bundled yet.
