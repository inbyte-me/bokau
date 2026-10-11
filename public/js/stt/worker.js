// Speech-to-text in a worker: quantized Whisper (ONNX, WASM/CPU) via transformers.js. Models are cached in ./models by the server.
import { pipeline, env, AutoProcessor, AutoModelForXVector } from '/vendor/transformers/transformers.min.js';

env.allowLocalModels = false;
env.remoteHost = `${self.location.origin}/hf/`;
env.remotePathTemplate = '{model}/resolve/{revision}/';
env.backends.onnx.wasm.wasmPaths = '/vendor/ort/';
env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, (self.navigator.hardwareConcurrency || 4) - 1));

let pipe = null, loadedModel = null; let xv = null;
const post = (m) => self.postMessage(m);

async function embed(data) {
  if (!xv || xv.name !== data.model) {
    post({ type: 'status', message: 'loading voice model' }); const files = new Map();
    const progress_callback = (p) => { if (p.status === 'progress' && p.file) { files.set(p.file, p); let l = 0, t = 0; for (const f of files.values()) { l += f.loaded || 0; t += f.total || 0; } post({ type: 'progress', stage: 'download', pct: t ? l / t : 0, file: p.file }); } };
    xv = { name: data.model, processor: await AutoProcessor.from_pretrained(data.model, { progress_callback }), model: await AutoModelForXVector.from_pretrained(data.model, { dtype: 'q8', device: 'wasm', progress_callback }) };
  }
  const out = [];
  for (let i = 0; i < data.windows.length; i++) {
    const inputs = await xv.processor(data.windows[i]); const { embeddings } = await xv.model(inputs);
    out.push(Array.from(embeddings.data)); post({ type: 'progress', stage: 'embed', pct: (i + 1) / data.windows.length });
  }
  post({ type: 'embeddings', id: data.id, embeddings: out });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'embed') return await embed(data);
    if (data.type === 'transcribe') {
      if (!pipe || loadedModel !== data.model) {
        pipe = null; post({ type: 'status', message: 'loading model' });
        const files = new Map();
        pipe = await pipeline('automatic-speech-recognition', data.model, {
          dtype: 'q8', device: 'wasm',
          progress_callback: (p) => { if (p.status === 'progress' && p.file) { files.set(p.file, p); let l = 0, t = 0; for (const f of files.values()) { l += f.loaded || 0; t += f.total || 0; } post({ type: 'progress', stage: 'download', pct: t ? l / t : 0, file: p.file }); } },
        });
        loadedModel = data.model;
      }
      post({ type: 'status', message: 'transcribing' });
      const opts = { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' };
      if (data.language && data.language !== 'auto') opts.language = data.language;
      const out = await pipe(data.audio, { ...opts, callback_function: undefined });
      post({ type: 'result', id: data.id, text: out.text, chunks: out.chunks || [{ text: out.text, timestamp: [0, data.audio.length / 16000] }] });
    }
  } catch (e) { post({ type: 'error', message: String(e?.message || e) }); }
};
