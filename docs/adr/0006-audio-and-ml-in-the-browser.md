# 0006: Audio and ML in the browser, files on the server

**Context.** Preview must match export exactly; recording needs sample-accurate scheduling; speech models must run
on a modest Intel Mac without a GPU.

**Decision.** All playback, recording and mixing is Web Audio in the page; export renders the same graph offline and
uploads WAVs, the server only muxes with ffmpeg (stream copy when possible). Speech recognition (Whisper) and voice
embeddings (WavLM) run in a Web Worker with transformers.js on WASM; the server proxies and caches model files.
ffmpeg work and Demucs stem separation run on the server as jobs.

**Consequences.** One mix implementation, testable through offline renders. ML works offline after the first
download and on machines where `onnxruntime-node` has no build. The browser does real work (rendering a long
project takes seconds), so the UI shows progress for it.
