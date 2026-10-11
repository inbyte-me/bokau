// Speaker identification helpers (pure, shared, tested): windowing, clustering of voice embeddings, turn building.

export const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
export function normalize(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, (x) => x / n); }

/** split speech segments into windows of about `win` seconds (never shorter than `min` unless the segment itself is) */
export function windowsFromSegments(segs, { win = 2.4, min = 0.7 } = {}) {
  const out = [];
  for (const s of segs) {
    const len = s.end - s.start; if (len < min) { out.push({ start: s.start, end: s.end, short: true }); continue; }
    const n = Math.max(1, Math.round(len / win)); const d = len / n;
    for (let i = 0; i < n; i++) out.push({ start: s.start + i * d, end: s.start + (i + 1) * d });
  }
  return out;
}

/**
 * Average-linkage agglomerative clustering on cosine similarity.
 * Merges while the best similarity >= threshold, and keeps merging while there are more than maxClusters.
 * returns labels[] (0..k-1, ordered by first appearance)
 */
export function cluster(embs, { threshold = 0.8, maxClusters = 8 } = {}) {
  const n = embs.length; if (!n) return [];
  const E = embs.map(normalize);
  let groups = E.map((e, i) => ({ members: [i], sum: Float32Array.from(e) }));
  const sim = (a, b) => { let s = 0; for (const i of a.members) for (const j of b.members) s += dot(E[i], E[j]); return s / (a.members.length * b.members.length); };
  for (;;) {
    let best = -2, bi = -1, bj = -1;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) { const s = sim(groups[i], groups[j]); if (s > best) { best = s; bi = i; bj = j; } }
    if (bi < 0 || (best < threshold && groups.length <= maxClusters)) break;
    groups[bi].members.push(...groups[bj].members); groups.splice(bj, 1);
  }
  const labels = new Array(n); groups.sort((a, b) => Math.min(...a.members) - Math.min(...b.members));
  groups.forEach((g, k) => g.members.forEach((m) => { labels[m] = k; }));
  return labels;
}

/**
 * Robust speaker clustering for x-vector style embeddings.
 *  1. If every window is highly similar in raw cosine terms, it is one speaker.
 *  2. Otherwise subtract the mean embedding (removes the component common to all voices, which is what makes raw cosine
 *     scores of different people look deceptively high) and cluster on the centred vectors.
 *  k forces an exact number of voices; otherwise the threshold decides, capped by maxClusters.
 */
export function clusterAuto(embs, { k = null, maxClusters = 6, rawThreshold = 0.72, threshold = 0.1 } = {}) {
  const n = embs.length; if (n === 0) return []; if (n === 1 || k === 1) return new Array(n).fill(0);
  const raw = embs.map(normalize);
  if (!k) { const one = cluster(raw, { threshold: rawThreshold, maxClusters: 1e9 }); if (new Set(one).size === 1) return one; }
  const mean = new Float32Array(raw[0].length); for (const e of raw) for (let i = 0; i < e.length; i++) mean[i] += e[i] / n;
  const centred = raw.map((e) => normalize(Float32Array.from(e, (v, i) => v - mean[i])));
  return k ? cluster(centred, { threshold: 2, maxClusters: k }) : cluster(centred, { threshold, maxClusters });
}

/** merge consecutive windows of one speaker into turns; absorb very short turns into their neighbours */
export function buildTurns(windows, labels, { gap = 0.6, minTurn = 0.6 } = {}) {
  const turns = [];
  windows.forEach((w, i) => { const l = labels[i]; const last = turns.at(-1); if (last && last.speaker === l && w.start - last.end <= gap) last.end = w.end; else turns.push({ start: w.start, end: w.end, speaker: l }); });
  for (let i = 0; i < turns.length; i++) { // tiny turn sandwiched between the same speaker: relabel
    const t = turns[i];
    if (t.end - t.start < minTurn && turns[i - 1] && turns[i + 1] && turns[i - 1].speaker === turns[i + 1].speaker) t.speaker = turns[i - 1].speaker;
  }
  const merged = [];
  for (const t of turns) { const last = merged.at(-1); if (last && last.speaker === t.speaker && t.start - last.end <= gap) last.end = t.end; else merged.push({ ...t }); }
  return merged;
}

export const SPEAKER_COLORS = ['#d97b66', '#6fb3a6', '#7a9cc9', '#a98bc4', '#c9946a', '#9bb86f', '#c78fa5', '#8aa0a8'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function makeSpeakers(k, nameFor = (i) => `Character ${LETTERS[i]}`) { return Array.from({ length: k }, (_, i) => ({ id: 's' + (i + 1), name: nameFor(i), color: SPEAKER_COLORS[i % SPEAKER_COLORS.length], muted: false, solo: false })); }

/** audible mask segments: [{start,end}] where the original dialogue must be silent */
export function silencedRanges(speakers, segments) {
  const anySolo = speakers.some((s) => s.solo);
  const off = new Set(speakers.filter((s) => s.muted || (anySolo && !s.solo)).map((s) => s.id));
  return segments.filter((g) => off.has(g.speaker)).map((g) => ({ start: g.start, end: g.end }));
}
/** gain curve (linear) at `rate` Hz for the dialogue stem: 0 inside silenced ranges, short fades at the edges */
export function maskCurve(ranges, from, duration, { rate = 200, fade = 0.015, pad = 0.03 } = {}) {
  const n = Math.max(2, Math.ceil(duration * rate) + 1); const c = new Float32Array(n).fill(1);
  for (const r of ranges) { const a = Math.max(0, Math.floor((r.start - pad - from) * rate)), b = Math.min(n - 1, Math.ceil((r.end + pad - from) * rate)); for (let i = a; i <= b; i++) c[i] = 0; }
  const f = Math.max(1, Math.round(fade * rate)); const out = Float32Array.from(c);
  for (let i = 0; i < n; i++) { if (c[i] === 0) for (let k = 1; k <= f; k++) { const g = k / (f + 1); if (i - k >= 0 && c[i - k] === 1) out[i - k] = Math.min(out[i - k], g); if (i + k < n && c[i + k] === 1) out[i + k] = Math.min(out[i + k], g); } }
  return out;
}
export const speakerAt = (segments, t) => segments.find((g) => t >= g.start && t < g.end)?.speaker ?? null;
/** which speaker mostly overlaps [start,end] */
export function dominantSpeaker(segments, start, end) {
  const acc = new Map(); for (const g of segments) { const o = Math.min(end, g.end) - Math.max(start, g.start); if (o > 0) acc.set(g.speaker, (acc.get(g.speaker) || 0) + o); }
  let best = null, bv = 0; for (const [k, v] of acc) if (v > bv) { best = k; bv = v; } return best;
}
