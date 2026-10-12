/// <reference lib="webworker" />
// Speech-to-text and voice embeddings in a worker: quantized ONNX models (WASM, CPU) via transformers.js.
// The library is served by our own server (/vendor/…) and models come through its caching proxy (/hf/…),
// so after the first download everything works offline.
import type * as Transformers from '@huggingface/transformers';
import type { WorkerReply, WorkerRequest } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;
type Lib = typeof Transformers;
type Pipe = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;
type XVector = { name: string; processor: (a: Float32Array) => Promise<unknown>; model: (i: unknown) => Promise<{ embeddings: { data: Float32Array } }> };

let libP: Promise<Lib> | null = null;
function lib(): Promise<Lib> {
  libP ||= (import(/* @vite-ignore */ `${self.location.origin}/vendor/transformers/transformers.min.js`) as Promise<Lib>).then((t) => {
    t.env.allowLocalModels = false;
    t.env.remoteHost = `${self.location.origin}/hf/`;
    t.env.remotePathTemplate = '{model}/resolve/{revision}/';
    const wasm = t.env.backends.onnx.wasm as { wasmPaths?: string; numThreads?: number };
    wasm.wasmPaths = `${self.location.origin}/vendor/ort/`;
    wasm.numThreads = Math.max(1, Math.min(4, (self.navigator.hardwareConcurrency || 4) - 1));
    return t;
  });
  return libP;
}

const post = (m: WorkerReply, transfer: Transferable[] = []) => self.postMessage(m, transfer);

/** aggregate per-file download progress into one fraction */
function downloads(id: string) {
  const files = new Map<string, { loaded?: number; total?: number }>();
  return (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file) return;
    files.set(p.file, p);
    let l = 0;
    let t = 0;
    for (const f of files.values()) {
      l += f.loaded || 0;
      t += f.total || 0;
    }
    post({ type: 'progress', id, stage: 'download', pct: t ? l / t : 0, file: p.file });
  };
}

let asr: { model: string; pipe: Pipe } | null = null;
let xv: XVector | null = null;

async function transcribe(m: Extract<WorkerRequest, { type: 'transcribe' }>) {
  const t = await lib();
  if (asr?.model !== m.model) {
    asr = null;
    post({ type: 'status', id: m.id, message: 'loading model' });
    const pipe = (await t.pipeline('automatic-speech-recognition', m.model, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: downloads(m.id),
    })) as unknown as Pipe;
    asr = { model: m.model, pipe };
  }
  post({ type: 'status', id: m.id, message: 'transcribing' });
  const opts: Record<string, unknown> = { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' };
  if (m.language && m.language !== 'auto') opts.language = m.language;
  const out = await asr.pipe(m.audio, opts);
  post({ type: 'result', id: m.id, text: out.text, chunks: out.chunks || [{ text: out.text, timestamp: [0, m.audio.length / 16000] }] });
}

async function embed(m: Extract<WorkerRequest, { type: 'embed' }>) {
  const t = await lib();
  if (xv?.name !== m.model) {
    post({ type: 'status', id: m.id, message: 'loading voice model' });
    const progress_callback = downloads(m.id);
    xv = {
      name: m.model,
      processor: (await t.AutoProcessor.from_pretrained(m.model, { progress_callback })) as unknown as XVector['processor'],
      model: (await t.AutoModelForXVector.from_pretrained(m.model, { dtype: 'q8', device: 'wasm', progress_callback })) as unknown as XVector['model'],
    };
  }
  const out: number[][] = [];
  for (let i = 0; i < m.windows.length; i++) {
    const { embeddings } = await xv.model(await xv.processor(m.windows[i]));
    out.push(Array.from(embeddings.data));
    post({ type: 'progress', id: m.id, stage: 'embed', pct: (i + 1) / m.windows.length });
  }
  post({ type: 'embeddings', id: m.id, embeddings: out });
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    if (data.type === 'embed') await embed(data);
    else if (data.type === 'transcribe') await transcribe(data);
  } catch (e) {
    post({ type: 'error', id: data.id, message: e instanceof Error ? e.message : String(e) });
  }
};
