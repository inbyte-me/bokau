import { buildMix } from './mixgraph.js';
import { audioBufferToWav } from './wav.js';

export const SAMPLE_RATE = 48000;

/** Render one of the export stems offline using the exact preview graph. */
export async function renderStem(project, assets, kind, { duration, onProgress } = {}) {
  const dur = duration ?? Math.max(project.media?.duration || 0, ...project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)));
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * SAMPLE_RATE), SAMPLE_RATE);
  const a = { ...assets, totalDuration: dur };
  const cfg = {
    mix: { include: { original: true, voices: true, ghost: false }, voiceMode: 'wet', ducking: true },
    bg: { include: { original: true, voices: false, ghost: false }, voiceMode: 'wet', ducking: false, forceOrigAudible: true },
    dry: { include: { original: false, voices: true, ghost: false }, voiceMode: 'dry', ducking: false },
    wet: { include: { original: false, voices: true, ghost: false }, voiceMode: 'wet', ducking: false },
  }[kind];
  // background stem should always be the music/sfx bed: use the bg stem when separated
  const p = kind === 'bg' ? { ...project, original: { ...project.original, source: assets.bg ? 'bg' : project.original.source, ghost: { ...project.original.ghost, enabled: false } } } : project;
  await buildMix(ctx, p, a, { from: 0, to: dur, when: 0, destination: ctx.destination, totalDuration: dur, ...cfg });
  if (onProgress) { const t = setInterval(() => onProgress(Math.min(0.99, ctx.currentTime / dur)), 250); try { return await ctx.startRendering(); } finally { clearInterval(t); } }
  return ctx.startRendering();
}

export async function renderAndUpload(project, assets, kinds, { onStep } = {}) {
  const out = {};
  for (const kind of kinds) {
    onStep?.(kind, 0);
    const buf = await renderStem(project, assets, kind, { onProgress: (f) => onStep?.(kind, f) });
    const blob = audioBufferToWav(buf, 16);
    const r = await fetch(`/api/projects/${project.id}/renders/${kind}`, { method: 'POST', body: blob });
    if (!r.ok) throw new Error(`upload ${kind}: ${r.status}`);
    out[kind] = { seconds: buf.duration, peak: peakOf(buf) };
    onStep?.(kind, 1);
  }
  return out;
}
export function peakOf(buf) { let p = 0; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; } } return p; }
