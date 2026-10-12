import type { Project } from '@doblaje/core';
import { computePeaks, type Peaks } from './peaks.ts';

/** Decoded audio the mix graph plays from. */
export interface MixAssets {
  orig: AudioBuffer | null;
  dialogue: AudioBuffer | null;
  bg: AudioBuffer | null;
  takes: Map<string, AudioBuffer>;
  /** RMS envelopes of takes, cached for ducking */
  envs: Map<string, Float32Array>;
  totalDuration?: number;
}

/** Decoded audio for the open project: original (+stems) and every take referenced by clips. */
export class Assets implements MixAssets {
  readonly ctx: BaseAudioContext;
  readonly id: string;
  orig: AudioBuffer | null = null;
  dialogue: AudioBuffer | null = null;
  bg: AudioBuffer | null = null;
  takes = new Map<string, AudioBuffer>();
  envs = new Map<string, Float32Array>();
  /** keyed by 'orig' | 'dialogue' | 'bg' | take file */
  peaks = new Map<string, Peaks>();
  totalDuration = 0;

  constructor(ctx: BaseAudioContext, projectId: string) {
    this.ctx = ctx;
    this.id = projectId;
  }
  async #decode(name: string): Promise<AudioBuffer> {
    const r = await fetch(`/media/${this.id}/${name}`);
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return this.ctx.decodeAudioData(await r.arrayBuffer());
  }
  async loadOriginal(): Promise<AudioBuffer> {
    const orig = await this.#decode('audio_orig.wav');
    this.orig = orig;
    this.peaks.set('orig', computePeaks(orig));
    return orig;
  }
  async loadStems(): Promise<void> {
    const [d, b] = await Promise.all([this.#decode('stem_dialogue.wav'), this.#decode('stem_bg.wav')]);
    this.dialogue = d;
    this.bg = b;
    this.peaks.set('dialogue', computePeaks(d));
    this.peaks.set('bg', computePeaks(b));
  }
  clearStems(): void {
    this.dialogue = null;
    this.bg = null;
    this.peaks.delete('dialogue');
    this.peaks.delete('bg');
  }
  addTake(file: string, buffer: AudioBuffer): void {
    this.takes.set(file, buffer);
    this.peaks.set(file, computePeaks(buffer));
    this.envs.delete(file);
  }
  async ensureTakes(project: Project): Promise<void> {
    const need = new Set<string>();
    for (const t of project.tracks) {
      for (const c of t.clips) need.add(c.file);
      for (const k of t.takes || []) need.add(k.file);
    }
    await Promise.all(
      [...need]
        .filter((f) => !this.takes.has(f))
        .map(async (f) => {
          try {
            this.addTake(f, await this.#decode(`takes/${f}`));
          } catch (e) {
            console.warn('missing take', f, e instanceof Error ? e.message : e);
          }
        }),
    );
  }
}
