import { rmsEnvelope, computePeaks } from './peaks.js';

/** Decoded audio for the open project: original (+stems) and every take referenced by clips. */
export class Assets {
  constructor(ctx, projectId) {
    this.ctx = ctx; this.id = projectId;
    this.orig = null; this.dialogue = null; this.bg = null;
    this.takes = new Map(); this.envs = new Map(); this.peaks = new Map(); // peaks keyed by 'orig'|'dialogue'|'bg'|take file
    this.totalDuration = 0;
  }
  async #decode(name) {
    const r = await fetch(`/media/${this.id}/${name}`);
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return this.ctx.decodeAudioData(await r.arrayBuffer());
  }
  async loadOriginal() { this.orig = await this.#decode('audio_orig.wav'); this.peaks.set('orig', computePeaks(this.orig)); return this.orig; }
  async loadStems() {
    const [d, b] = await Promise.all([this.#decode('stem_dialogue.wav'), this.#decode('stem_bg.wav')]);
    this.dialogue = d; this.bg = b; this.peaks.set('dialogue', computePeaks(d)); this.peaks.set('bg', computePeaks(b));
  }
  clearStems() { this.dialogue = this.bg = null; this.peaks.delete('dialogue'); this.peaks.delete('bg'); }
  addTake(file, buffer) { this.takes.set(file, buffer); this.peaks.set(file, computePeaks(buffer)); this.envs.delete(file); }
  async ensureTakes(project) {
    const need = new Set(); for (const t of project.tracks) { for (const c of t.clips) need.add(c.file); for (const k of t.takes || []) need.add(k.file); }
    await Promise.all([...need].filter((f) => !this.takes.has(f)).map(async (f) => { try { this.addTake(f, await this.#decode(`takes/${f}`)); } catch (e) { console.warn('missing take', f, e.message); } }));
  }
}
