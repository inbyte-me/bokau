import { buildTurns, clusterAuto, makeSpeakers, type Project, type Speaker, type SpeakerSegment, type TimeRange, windowsFromSegments } from '@doblaje/core';
import type { WorkerProgress } from './protocol.ts';
import { load16k } from './stt-client.ts';
import { request } from './worker-client.ts';

export const VOICE_MODEL = 'Xenova/wavlm-base-plus-sv';

export interface IdentifyOptions {
  onProgress?: (p: WorkerProgress | { type: 'status'; message: string }) => void;
  threshold?: number;
  maxSpeakers?: number;
  /** force this many voices */
  count?: number | null;
  nameFor?: (i: number) => string;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Who speaks when. Works on the separated dialogue track (needs stems), so music never confuses the voice model.
 */
export async function identifySpeakers(
  project: Project,
  { onProgress, threshold = 0.1, maxSpeakers = 6, count = null, nameFor }: IdentifyOptions = {},
): Promise<{ speakers: Speaker[]; segments: SpeakerSegment[]; model: string }> {
  onProgress?.({ type: 'status', message: 'finding speech' });
  const res = await fetch(`/api/projects/${project.id}/speech-segments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ minSilence: 0.35, mergeGap: 0.3, minSpeech: 0.3 }),
  });
  if (!res.ok) throw new Error(`speech segments: HTTP ${res.status}`);
  const { segments } = (await res.json()) as { segments: TimeRange[] };
  if (!segments.length) throw new Error('No speech found in the dialogue track');
  const audio = await load16k(`/media/${project.id}/stem_dialogue.wav`);
  const wins = windowsFromSegments(segments, { win: 2.0, min: 0.6 });
  const clips = wins.map((w) => audio.slice(Math.floor(w.start * 16000), Math.min(audio.length, Math.ceil(w.end * 16000))));
  const keep = clips.map((_, i) => i).filter((i) => clips[i].length >= 16000 * 0.5); // too-short windows carry no voice information
  const { embeddings } = await request<'embeddings'>({ type: 'embed', model: VOICE_MODEL, windows: keep.map((i) => clips[i]) }, { onProgress });
  const labelsKept = clusterAuto(embeddings, { threshold, maxClusters: maxSpeakers, k: count });
  // short windows inherit the label of the nearest embedded window
  const labels = wins.map((w, i) => {
    const k = keep.indexOf(i);
    if (k >= 0) return labelsKept[k];
    let best = 0;
    let bd = 1e9;
    keep.forEach((j, kk) => {
      const d = Math.abs(wins[j].start - w.start);
      if (d < bd) {
        bd = d;
        best = labelsKept[kk];
      }
    });
    return best;
  });
  const turns = buildTurns(wins, labels);
  const ids = [...new Set(turns.map((t) => t.speaker))];
  const speakers = makeSpeakers(Math.max(1, ids.length), nameFor);
  return {
    speakers,
    segments: turns.map((t) => ({ start: round(t.start), end: round(t.end), speaker: speakers[ids.indexOf(t.speaker)].id })),
    model: VOICE_MODEL,
  };
}
