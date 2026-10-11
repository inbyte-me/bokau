import { api } from '../api.js';
import { load16k } from '../stt/client.js';
import { windowsFromSegments, clusterAuto, buildTurns, makeSpeakers, dominantSpeaker } from '/shared/diarize.js';

export const VOICE_MODEL = 'Xenova/wavlm-base-plus-sv';
let worker = null;
function embedWindows(windows, { onProgress } = {}) {
  worker ||= new Worker('/js/stt/worker.js', { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => { if (data.type === 'progress' || data.type === 'status') onProgress?.(data); else if (data.type === 'embeddings') resolve(data.embeddings); else if (data.type === 'error') reject(new Error(data.message)); };
    worker.onerror = (e) => reject(new Error(e.message || 'voice model worker crashed'));
    worker.postMessage({ type: 'embed', id: 'e', model: VOICE_MODEL, windows });
  });
}

/**
 * Who speaks when. Works on the separated dialogue track (needs stems), so music never confuses the voice model.
 * returns { speakers:[{id,name,color,muted,solo}], segments:[{start,end,speaker}] }
 */
export async function identifySpeakers(project, { onProgress, threshold = 0.1, maxSpeakers = 6, count = null, nameFor } = {}) {
  onProgress?.({ type: 'status', message: 'finding speech' });
  const { segments } = await api.post(`/api/projects/${project.id}/speech-segments`, { minSilence: 0.35, mergeGap: 0.3, minSpeech: 0.3 });
  if (!segments.length) throw new Error('No speech found in the dialogue track');
  const audio = await load16k(`/media/${project.id}/stem_dialogue.wav`);
  const wins = windowsFromSegments(segments, { win: 2.0, min: 0.6 });
  const clips = wins.map((w) => audio.slice(Math.floor(w.start * 16000), Math.min(audio.length, Math.ceil(w.end * 16000))));
  const keep = clips.map((c, i) => i).filter((i) => clips[i].length >= 16000 * 0.5); // too short windows carry no voice information
  const embs = await embedWindows(keep.map((i) => clips[i]), { onProgress });
  const labelsKept = clusterAuto(embs, { threshold, maxClusters: maxSpeakers, k: count });
  // short windows inherit the label of the nearest embedded window
  const labels = wins.map((w, i) => { const k = keep.indexOf(i); if (k >= 0) return labelsKept[k]; let best = 0, bd = 1e9; keep.forEach((j, kk) => { const d = Math.abs(wins[j].start - w.start); if (d < bd) { bd = d; best = labelsKept[kk]; } }); return best; });
  const turns = buildTurns(wins, labels);
  const k = new Set(turns.map((t) => t.speaker)).size;
  const speakers = makeSpeakers(Math.max(1, k), nameFor);
  const ids = [...new Set(turns.map((t) => t.speaker))];
  return { speakers, segments: turns.map((t) => ({ start: round(t.start), end: round(t.end), speaker: speakers[ids.indexOf(t.speaker)].id })), model: VOICE_MODEL };
}
const round = (n) => Math.round(n * 1000) / 1000;
export { dominantSpeaker };
