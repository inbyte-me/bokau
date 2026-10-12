import { chunksToCues, type Project, snapCues, type TextCue, type TimeRange } from '@doblaje/core';
import type { AsrChunkMsg, WorkerProgress } from './protocol.ts';
import { request } from './worker-client.ts';

export const STT_MODELS = [
  { id: 'Xenova/whisper-tiny', label: 'Tiny multilingual (≈40 MB, fastest)' },
  { id: 'Xenova/whisper-base', label: 'Base multilingual (≈80 MB, better)' },
  { id: 'Xenova/whisper-small', label: 'Small multilingual (≈250 MB, best, slow on CPU)' },
] as const;

/** 16 kHz mono Float32 from a wav URL (decodeAudioData resamples to the context rate). */
export async function load16k(url: string): Promise<Float32Array> {
  const ab = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const buf = await ctx.decodeAudioData(ab);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return normalizePeak(out);
}

/** Quiet budget-mic recordings confuse speech models: bring the peak to about -3 dBFS (max +30 dB, never attenuate). */
export function normalizePeak(x: Float32Array, target = 0.7, maxGainDb = 30): Float32Array {
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-4) return x;
  const g = Math.min(target / peak, 10 ** (maxGainDb / 20));
  if (g > 1.05) for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

export interface TranscribeOptions {
  model?: string;
  language?: string;
  onProgress?: (p: WorkerProgress) => void;
}

export async function transcribe(
  audio: Float32Array,
  { model = 'Xenova/whisper-tiny', language = 'auto', onProgress }: TranscribeOptions = {},
): Promise<{ text: string; chunks: AsrChunkMsg[] }> {
  const r = await request<'result'>({ type: 'transcribe', audio, model, language }, { onProgress, transfer: [audio.buffer] });
  return { text: r.text, chunks: r.chunks };
}

/** Transcribe a project's dialogue (stem if separated) into cue-sized lines snapped to real speech edges. */
export async function transcribeProject(project: Project, opts?: TranscribeOptions): Promise<{ text: string; chunks: AsrChunkMsg[]; cues: TextCue[] }> {
  const duration = project.media?.duration || 0;
  const audio = await load16k(`/media/${project.id}/${project.stems?.status === 'ready' ? 'stem_dialogue.wav' : 'audio_16k.wav'}`);
  const r = await transcribe(audio, opts);
  let cues = chunksToCues(r.chunks, { duration });
  try {
    // snap to real speech edges (server-side silence detection on the dialogue stem when available)
    const res = await fetch(`/api/projects/${project.id}/speech-segments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const { segments } = (await res.json()) as { segments: TimeRange[] };
    cues = snapCues(cues, segments, { duration });
  } catch {}
  return { ...r, cues };
}
