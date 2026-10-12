import type { Project } from '@doblaje/core';
import type { MixAssets } from './assets.ts';
import { buildMix, type MixOptions } from './mixgraph.ts';
import { audioBufferToWav } from './wav.ts';

export const SAMPLE_RATE = 48000;
export type StemKind = 'mix' | 'bg' | 'dry' | 'wet';

const STEMS: Record<StemKind, Pick<MixOptions, 'include' | 'voiceMode' | 'ducking'>> = {
  mix: { include: { original: true, voices: true, ghost: false }, voiceMode: 'wet', ducking: true },
  bg: { include: { original: true, voices: false, ghost: false }, voiceMode: 'wet', ducking: false },
  dry: { include: { original: false, voices: true, ghost: false }, voiceMode: 'dry', ducking: false },
  wet: { include: { original: false, voices: true, ghost: false }, voiceMode: 'wet', ducking: false },
};

/** Render one of the export stems offline using the exact preview graph. */
export async function renderStem(
  project: Project,
  assets: MixAssets,
  kind: StemKind,
  { duration, onProgress }: { duration?: number; onProgress?: (f: number) => void } = {},
): Promise<AudioBuffer> {
  const dur = duration ?? Math.max(project.media?.duration || 0, ...project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)));
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * SAMPLE_RATE), SAMPLE_RATE);
  // the background stem is always the music/sfx bed: use the bg stem when separated
  const p: Project =
    kind === 'bg'
      ? {
          ...project,
          original: { ...project.original, source: assets.bg ? 'bg' : project.original.source, ghost: { ...project.original.ghost, enabled: false } },
        }
      : project;
  await buildMix(ctx, p, { ...assets, totalDuration: dur }, { from: 0, to: dur, when: 0, destination: ctx.destination, totalDuration: dur, ...STEMS[kind] });
  if (!onProgress) return ctx.startRendering();
  const t = setInterval(() => onProgress(Math.min(0.99, ctx.currentTime / dur)), 250);
  try {
    return await ctx.startRendering();
  } finally {
    clearInterval(t);
  }
}

export async function renderAndUpload(
  project: Project,
  assets: MixAssets,
  kinds: StemKind[],
  { onStep }: { onStep?: (kind: StemKind, f: number) => void } = {},
) {
  const out: Partial<Record<StemKind, { seconds: number; peak: number }>> = {};
  for (const kind of kinds) {
    onStep?.(kind, 0);
    const buf = await renderStem(project, assets, kind, { onProgress: (f) => onStep?.(kind, f) });
    const r = await fetch(`/api/projects/${project.id}/renders/${kind}`, { method: 'POST', body: audioBufferToWav(buf, 16) });
    if (!r.ok) throw new Error(`upload ${kind}: ${r.status}`);
    out[kind] = { seconds: buf.duration, peak: peakOf(buf) };
    onStep?.(kind, 1);
  }
  return out;
}

export function peakOf(buf: AudioBuffer): number {
  let p = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > p) p = a;
    }
  }
  return p;
}
