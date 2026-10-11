import { chunksToCues, snapCues } from '/shared/transcribe.js';

export const STT_MODELS = [
  { id: 'Xenova/whisper-tiny', label: 'Tiny multilingual (≈40 MB, fastest)' },
  { id: 'Xenova/whisper-base', label: 'Base multilingual (≈80 MB, better)' },
  { id: 'Xenova/whisper-small', label: 'Small multilingual (≈250 MB, best, slow on CPU)' },
];

/** 16 kHz mono Float32 from a wav URL (decodeAudioData resamples to the context rate). */
export async function load16k(url) {
  const ab = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const buf = await ctx.decodeAudioData(ab);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < out.length; i++) out[i] += d[i] / buf.numberOfChannels; }
  return out;
}

let worker = null;
export function transcribe(audio, { model = 'Xenova/whisper-tiny', language = 'auto', onProgress } = {}) {
  if (!worker) worker = new Worker('/js/stt/worker.js', { type: 'module' });
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress' || data.type === 'status') onProgress?.(data);
      else if (data.type === 'result') resolve({ text: data.text, chunks: data.chunks });
      else if (data.type === 'error') reject(new Error(data.message));
    };
    worker.onerror = (e) => reject(new Error(e.message || 'worker crashed'));
    worker.postMessage({ type: 'transcribe', id, audio, model, language }, [audio.buffer.slice ? audio.buffer : audio.buffer]);
  });
}

export async function transcribeProject(project, opts) {
  const f = project.stems?.status === 'ready' ? 'stem_dialogue.wav' : 'audio_16k.wav';
  const audio = await load16k(`/media/${project.id}/${f}`);
  const r = await transcribe(audio, opts);
  let cues = chunksToCues(r.chunks, { duration: project.media.duration });
  try { // snap to real speech edges (server-side silence detection on the dialogue stem when available)
    const { segments } = await (await fetch(`/api/projects/${project.id}/speech-segments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    cues = snapCues(cues, segments, { duration: project.media.duration });
  } catch {}
  return { ...r, cues };
}
