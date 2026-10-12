// Turn raw speech-recognition chunks into cue-sized subtitle lines (shared, pure, testable).

import type { TimeRange } from './project.ts';
import { countText, detectLang } from './syllables.ts';

const SENT = /(?<=[.!?…。¿¡])\s+/;

export interface AsrChunk {
  text: string;
  timestamp?: [number, number | null];
}
export interface TextCue extends TimeRange {
  text: string;
  snapped?: boolean;
}

/**
 * chunks -> cues, each <= maxSec / maxChars. Long chunks are split on sentence boundaries
 * (then commas / word counts) with time shared by syllables.
 */
export function chunksToCues(chunks: AsrChunk[], { maxSec = 6.5, maxChars = 84, minSec = 0.6, duration = Number.POSITIVE_INFINITY } = {}): TextCue[] {
  const out: TextCue[] = [];
  for (const ch of chunks) {
    const text = (ch.text || '').replace(/\s+/g, ' ').trim();
    if (!text || /^[[(♪\s]*(music|silence|applause|música)?[\])♪\s]*$/i.test(text)) continue;
    const s = ch.timestamp?.[0] ?? 0;
    let e = ch.timestamp?.[1] ?? null;
    if (e == null || e <= s) e = Math.min(duration, s + Math.max(minSec, text.length * 0.07));
    const pieces = splitText(text, Math.max(1, Math.ceil(Math.max((e - s) / maxSec, text.length / maxChars))));
    const lang = detectLang(text);
    const w = pieces.map((p) => Math.max(1, countText(p, lang)));
    const tot = w.reduce((a, b) => a + b, 0);
    let t = s;
    pieces.forEach((p, i) => {
      const d = ((e - s) * w[i]) / tot;
      out.push({ start: round(t), end: round(Math.min(duration, t + d)), text: p });
      t += d;
    });
  }
  return out.filter((c) => c.end > c.start + 0.05);
}

function splitText(text: string, n: number): string[] {
  if (n <= 1) return [text];
  let parts = text.split(SENT).filter(Boolean);
  if (parts.length < n) parts = parts.flatMap((p) => (p.length > 60 ? p.split(/(?<=[,;:])\s+/) : [p]));
  while (parts.length < n) {
    // last resort: halve the longest by words
    parts.sort((a, b) => b.length - a.length);
    const long = parts.shift() as string;
    const ws = long.split(' ');
    if (ws.length < 2) {
      parts.unshift(long);
      break;
    }
    const mid = Math.ceil(ws.length / 2);
    parts.push(ws.slice(0, mid).join(' '), ws.slice(mid).join(' '));
  }
  // keep original order: rebuild from text positions
  let pos = 0;
  const idx = parts.map((p) => {
    const i = text.indexOf(p, pos);
    if (i >= 0) pos = i + p.length;
    return { p, i: i < 0 ? 1e9 : i };
  });
  idx.sort((a, b) => a.i - b.i);
  const merged: string[] = []; // merge pieces that are tiny
  for (const { p } of idx) {
    const last = merged[merged.length - 1];
    if (last && (p.length < 12 || last.length < 12) && last.length + p.length < 90) merged[merged.length - 1] = `${last} ${p}`;
    else merged.push(p);
  }
  return merged;
}
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Make cue skeletons from speech segments (no text) for the manual / AI-driven modes. */
export function segmentsToCues(segs: TimeRange[], { text = '', maxSec = 6.5 } = {}): TextCue[] {
  const out: TextCue[] = [];
  for (const s of segs) {
    const n = Math.max(1, Math.ceil((s.end - s.start) / maxSec));
    const d = (s.end - s.start) / n;
    for (let i = 0; i < n; i++) out.push({ start: round(s.start + i * d), end: round(s.start + (i + 1) * d), text });
  }
  return out;
}

/**
 * Tighten cue edges to real speech: start moves to the first speech segment that overlaps the cue,
 * end to the last one (never past the next cue). No-op if the segments carry no information (one big blob).
 */
export function snapCues<C extends TimeRange & { snapped?: boolean }>(
  cues: C[],
  segs: TimeRange[] | null | undefined,
  { minGain = 0.05, duration = Number.POSITIVE_INFINITY } = {},
): C[] {
  if (!segs?.length) return cues;
  const covered = segs.reduce((a, s) => a + (s.end - s.start), 0);
  if (covered > duration * 0.97 || (segs.length === 1 && segs[0].start < 0.05 && segs[0].end > duration - 0.05)) return cues; // continuous audio: nothing to snap to
  return cues.map((c, i) => {
    const hit = segs.filter((s) => s.end > c.start + 0.02 && s.start < c.end - 0.02);
    if (!hit.length) return c;
    const next = cues[i + 1];
    const start = c.start < hit[0].start ? hit[0].start : c.start;
    let end = Math.min(c.end, (hit.at(-1) as TimeRange).end);
    if (next) end = Math.min(end, next.start);
    if (end - start < 0.3) return c;
    return { ...c, start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, snapped: start - c.start > minGain || c.end - end > minGain };
  });
}
