// Speaker identification helpers (pure, shared, tested): windowing, clustering of voice embeddings, turn building.
import type { Speaker, SpeakerSegment, TimeRange } from './project.ts';

export type Vec = ArrayLike<number>;

export const dot = (a: Vec, b: Vec): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
export function normalize(v: Vec): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v as ArrayLike<number>, (x) => x / n);
}

export interface Window extends TimeRange {
  short?: boolean;
}

/** split speech segments into windows of about `win` seconds (never shorter than `min` unless the segment itself is) */
export function windowsFromSegments(segs: TimeRange[], { win = 2.4, min = 0.7 } = {}): Window[] {
  const out: Window[] = [];
  for (const s of segs) {
    const len = s.end - s.start;
    if (len < min) {
      out.push({ start: s.start, end: s.end, short: true });
      continue;
    }
    const n = Math.max(1, Math.round(len / win));
    const d = len / n;
    for (let i = 0; i < n; i++) out.push({ start: s.start + i * d, end: s.start + (i + 1) * d });
  }
  return out;
}

/**
 * Average-linkage agglomerative clustering on cosine similarity.
 * Merges while the best similarity >= threshold, and keeps merging while there are more than maxClusters.
 * Returns labels (0..k-1, ordered by first appearance).
 */
export function cluster(embs: Vec[], { threshold = 0.8, maxClusters = 8 } = {}): number[] {
  const n = embs.length;
  if (!n) return [];
  const E = embs.map(normalize);
  const groups = E.map((_, i) => ({ members: [i] }));
  const sim = (a: { members: number[] }, b: { members: number[] }) => {
    let s = 0;
    for (const i of a.members) for (const j of b.members) s += dot(E[i], E[j]);
    return s / (a.members.length * b.members.length);
  };
  for (;;) {
    let best = -2;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const s = sim(groups[i], groups[j]);
        if (s > best) {
          best = s;
          bi = i;
          bj = j;
        }
      }
    if (bi < 0 || (best < threshold && groups.length <= maxClusters)) break;
    groups[bi].members.push(...groups[bj].members);
    groups.splice(bj, 1);
  }
  const labels = new Array<number>(n);
  groups.sort((a, b) => Math.min(...a.members) - Math.min(...b.members));
  groups.forEach((g, k) => {
    for (const m of g.members) labels[m] = k;
  });
  return labels;
}

/**
 * Robust speaker clustering for x-vector style embeddings.
 *  1. If every window is highly similar in raw cosine terms, it is one speaker.
 *  2. Otherwise subtract the mean embedding (removes the component common to all voices, which is what makes raw cosine
 *     scores of different people look deceptively high) and cluster on the centred vectors.
 *  k forces an exact number of voices; otherwise the threshold decides, capped by maxClusters.
 */
export function clusterAuto(
  embs: Vec[],
  {
    k = null,
    maxClusters = 6,
    rawThreshold = 0.72,
    threshold = 0.1,
  }: { k?: number | null; maxClusters?: number; rawThreshold?: number; threshold?: number } = {},
): number[] {
  const n = embs.length;
  if (n === 0) return [];
  if (n === 1 || k === 1) return new Array(n).fill(0);
  const raw = embs.map(normalize);
  if (!k) {
    const one = cluster(raw, { threshold: rawThreshold, maxClusters: 1e9 });
    if (new Set(one).size === 1) return one;
  }
  const mean = new Float32Array(raw[0].length);
  for (const e of raw) for (let i = 0; i < e.length; i++) mean[i] += e[i] / n;
  const centred = raw.map((e) => normalize(Float32Array.from(e, (v, i) => v - mean[i])));
  return k ? cluster(centred, { threshold: 2, maxClusters: k }) : cluster(centred, { threshold, maxClusters });
}

export interface Turn extends TimeRange {
  speaker: number;
}

/** merge consecutive windows of one speaker into turns; absorb very short turns into their neighbours */
export function buildTurns(windows: TimeRange[], labels: number[], { gap = 0.6, minTurn = 0.6 } = {}): Turn[] {
  const turns: Turn[] = [];
  windows.forEach((w, i) => {
    const l = labels[i];
    const last = turns.at(-1);
    if (last && last.speaker === l && w.start - last.end <= gap) last.end = w.end;
    else turns.push({ start: w.start, end: w.end, speaker: l });
  });
  for (let i = 0; i < turns.length; i++) {
    // tiny turn sandwiched between the same speaker: relabel
    const t = turns[i];
    if (t.end - t.start < minTurn && turns[i - 1] && turns[i + 1] && turns[i - 1].speaker === turns[i + 1].speaker) t.speaker = turns[i - 1].speaker;
  }
  const merged: Turn[] = [];
  for (const t of turns) {
    const last = merged.at(-1);
    if (last && last.speaker === t.speaker && t.start - last.end <= gap) last.end = t.end;
    else merged.push({ ...t });
  }
  return merged;
}

export const SPEAKER_COLORS = ['#d97b66', '#6fb3a6', '#7a9cc9', '#a98bc4', '#c9946a', '#9bb86f', '#c78fa5', '#8aa0a8'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function makeSpeakers(k: number, nameFor: (i: number) => string = (i) => `Character ${LETTERS[i]}`): Speaker[] {
  return Array.from({ length: k }, (_, i) => ({
    id: `s${i + 1}`,
    name: nameFor(i),
    color: SPEAKER_COLORS[i % SPEAKER_COLORS.length],
    muted: false,
    solo: false,
  }));
}

/** ranges where the original dialogue must be silent */
export function silencedRanges(speakers: Speaker[], segments: SpeakerSegment[]): TimeRange[] {
  const anySolo = speakers.some((s) => s.solo);
  const off = new Set(speakers.filter((s) => s.muted || (anySolo && !s.solo)).map((s) => s.id));
  return segments.filter((g) => off.has(g.speaker)).map((g) => ({ start: g.start, end: g.end }));
}

/** gain curve (linear) at `rate` Hz for the dialogue stem: 0 inside silenced ranges, short fades at the edges */
export function maskCurve(ranges: TimeRange[], from: number, duration: number, { rate = 200, fade = 0.015, pad = 0.03 } = {}): Float32Array {
  const n = Math.max(2, Math.ceil(duration * rate) + 1);
  const c = new Float32Array(n).fill(1);
  for (const r of ranges) {
    const a = Math.max(0, Math.floor((r.start - pad - from) * rate));
    const b = Math.min(n - 1, Math.ceil((r.end + pad - from) * rate));
    for (let i = a; i <= b; i++) c[i] = 0;
  }
  const f = Math.max(1, Math.round(fade * rate));
  const out = Float32Array.from(c);
  for (let i = 0; i < n; i++) {
    if (c[i] !== 0) continue;
    for (let k = 1; k <= f; k++) {
      const g = k / (f + 1);
      if (i - k >= 0 && c[i - k] === 1) out[i - k] = Math.min(out[i - k], g);
      if (i + k < n && c[i + k] === 1) out[i + k] = Math.min(out[i + k], g);
    }
  }
  return out;
}

export const speakerAt = (segments: SpeakerSegment[], t: number): string | null => segments.find((g) => t >= g.start && t < g.end)?.speaker ?? null;

/** which speaker mostly overlaps [start,end] */
export function dominantSpeaker(segments: SpeakerSegment[], start: number, end: number): string | null {
  const acc = new Map<string, number>();
  for (const g of segments) {
    const o = Math.min(end, g.end) - Math.max(start, g.start);
    if (o > 0) acc.set(g.speaker, (acc.get(g.speaker) || 0) + o);
  }
  let best: string | null = null;
  let bv = 0;
  for (const [k, v] of acc)
    if (v > bv) {
      best = k;
      bv = v;
    }
  return best;
}

/** Passages shorter than this are not created by a split (a click near an edge does nothing). */
export const MIN_PASSAGE = 0.12;

/** Split passage `idx` at time `t` into two passages of the same speaker. Returns null when `t` is too close to an edge. */
export function splitSegment(segments: SpeakerSegment[], idx: number, t: number, minLen = MIN_PASSAGE): SpeakerSegment[] | null {
  const g = segments[idx];
  if (!g || t - g.start < minLen || g.end - t < minLen) return null;
  const out = segments.slice();
  out.splice(idx, 1, { ...g, end: t }, { ...g, start: t });
  return out;
}

/** Give passage `idx` to `speaker`; neighbours that touch it and now share its speaker merge into one passage. */
export function assignSegment(segments: SpeakerSegment[], idx: number, speaker: string): SpeakerSegment[] {
  const out = segments.map((g, i) => (i === idx ? { ...g, speaker } : { ...g }));
  return mergeTouching(out);
}

/** Merge consecutive passages of the same speaker that touch (gap under `gap` seconds). Input order is by time. */
export function mergeTouching(segments: SpeakerSegment[], gap = 0.01): SpeakerSegment[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const out: SpeakerSegment[] = [];
  for (const g of sorted) {
    const last = out.at(-1);
    if (last && last.speaker === g.speaker && g.start - last.end <= gap) last.end = Math.max(last.end, g.end);
    else out.push({ ...g });
  }
  return out;
}

/** Index of the passage containing `t` (optionally only for one speaker), or -1. */
export const segmentAt = (segments: SpeakerSegment[], t: number, speaker?: string): number =>
  segments.findIndex((g) => (!speaker || g.speaker === speaker) && t >= g.start && t < g.end);
