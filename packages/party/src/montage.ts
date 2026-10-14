// The trailer as a montage: which stretches of the clip play in what order, and the title cards between them.
// Pure: the server cuts the media by `parts` and `compileTrailer` lays the takes along the same timeline.
import type { MediaPart } from '@doblaje/core';
import type { Room } from './protocol.ts';

/** What the AI (or the offline generator) writes around the players' words. All of it is optional. */
export interface TrailerCopy {
  /** the opening card: the pitch, as a trailer would say it */
  opening: string;
  /** a line for the gap after each scene (empty: just a dip to black) */
  narrator: string[];
  /** a made-up newspaper for each critic, in the order the reviews were written */
  publications: string[];
  tagline: string;
}

export type CardKind = 'opening' | 'narrator' | 'critic' | 'title';

/** A title card: text on black, in the montage's time. */
export interface TrailerCard {
  kind: CardKind;
  text: string;
  /** a critic's newspaper, or the title's tagline */
  sub?: string;
  /** a critic's name */
  by?: string;
  at: number;
  seconds: number;
}

/** A scene of the trailer, where it lies in the clip and in the trailer. */
export interface TrailerPlaced {
  cueId: string;
  /** who speaks in it, and who performed it */
  character: string;
  playerId: string;
  /** in the clip */
  start: number;
  end: number;
  /** in the trailer */
  at: number;
}

/** What a finished trailer round records in its project (`party.trailer`). */
export interface TrailerResult {
  logline: string;
  title: string;
  tagline: string;
  cards: TrailerCard[];
  scenes: TrailerPlaced[];
  duration: number;
}

export interface MontagePlan {
  result: TrailerResult;
  /** the media, in order: scenes of the clip and gaps of black */
  parts: MediaPart[];
}

/** A dip to black between two scenes that have no card. */
export const DIP_SECONDS = 0.5;
export const TITLE_SECONDS = 5;
/** Time to read a card: a little more for longer text. */
export const cardSeconds = (text: string): number => Math.min(5.5, Math.max(2.4, 1.8 + text.length * 0.07));

/** Order the scenes and cards of a finished trailer round. */
export function planTrailer(room: Room, copy: Partial<TrailerCopy> = {}): MontagePlan {
  const tr = room.trailer;
  const logline = tr?.logline ?? room.clip?.name ?? '';
  const title = tr?.title ?? room.clip?.name ?? '';
  const parts: MediaPart[] = [];
  const cards: TrailerCard[] = [];
  const scenes: TrailerPlaced[] = [];
  let at = 0;
  const card = (c: Omit<TrailerCard, 'at' | 'seconds'>, seconds = cardSeconds(c.text)) => {
    cards.push({ ...c, at, seconds });
    parts.push({ gap: seconds });
    at += seconds;
  };
  if (!tr) return { result: { logline, title, tagline: '', cards, scenes, duration: 0 }, parts };

  card({ kind: 'opening', text: copy.opening?.trim() || logline });
  tr.scenes.forEach((s, i) => {
    const line = room.lines.find((l) => l.cueId === s.cueId);
    if (!line) return;
    scenes.push({ cueId: s.cueId, character: s.character, playerId: s.playerId, start: line.start, end: line.end, at });
    parts.push({ start: line.start, end: line.end });
    at += line.end - line.start;
    if (i === tr.scenes.length - 1) return;
    const review = tr.reviews.find((r) => r.gap === i);
    const narrator = copy.narrator?.[i]?.trim();
    if (review) {
      const k = tr.reviews.indexOf(review);
      const by = room.players.find((p) => p.id === review.playerId)?.name;
      card({ kind: 'critic', text: review.text, ...(copy.publications?.[k] ? { sub: copy.publications[k] } : {}), ...(by ? { by } : {}) });
    } else if (narrator) card({ kind: 'narrator', text: narrator });
    else {
      parts.push({ gap: DIP_SECONDS });
      at += DIP_SECONDS;
    }
  });
  const tagline = copy.tagline?.trim() ?? '';
  card({ kind: 'title', text: title, ...(tagline ? { sub: tagline } : {}) }, TITLE_SECONDS);
  return { result: { logline, title, tagline, cards, scenes, duration: at }, parts };
}
