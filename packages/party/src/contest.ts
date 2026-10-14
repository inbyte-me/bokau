// A contest: some players each write one short text, then vote for the best one (never their own); the winner's text
// is the result. Pure data and functions, so any game that asks the room for words can use it (the trailer game asks
// for the pitch, every scene's direction and the title).
import type { Rng } from './rng.ts';

export const MAX_ENTRY_CHARS = 140;
/** Seconds each player has to describe their character. */
export const CARD_SECONDS = 60;
/** Seconds the vote lasts (it ends as soon as everyone has voted). */
export const VOTE_SECONDS = 15;
/** Fewer writers than this and a vote is pointless (each would vote for the other): the winner is picked at random. */
export const MIN_VOTERS = 3;
/** Seconds the server may take to fill in a contest nobody answered (the AI), before the fallback text is used. */
export const FILL_GRACE_S = 12;

/** pitch, direction, title: the trailer game. card: one player describes one character (no vote, a single writer). */
export type ContestKind = 'pitch' | 'direction' | 'title' | 'card';
export type ContestStage = 'write' | 'vote' | 'done';

export interface Entry {
  id: string;
  playerId: string;
  text: string;
}

export interface Contest {
  id: string;
  kind: ContestKind;
  /** the scene the text is for (directions), else null */
  scene: number | null;
  /** what it is about besides a scene: the character a card describes */
  subject: string | null;
  /** the players who write and then vote */
  who: string[];
  stage: ContestStage;
  /** epoch ms: when the current stage ends (while `fill`, when the fallback replaces the wait) */
  deadline: number;
  entries: Entry[];
  /** voter id → entry id */
  votes: Record<string, string>;
  /** the winning entry */
  winner: string | null;
  /** the result: the winner's text, or what filled in for nobody */
  text: string | null;
  /** nobody wrote anything: the server may supply a text until `deadline`, then the fallback is used */
  fill: boolean;
}

/** Text from a phone, made safe to show: no control characters, trimmed, short. */
export const cleanEntry = (raw: unknown): string =>
  String(raw ?? '')
    .replace(/\p{C}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ENTRY_CHARS);

export function openContest(
  id: string,
  kind: ContestKind,
  who: readonly string[],
  deadline: number,
  scene: number | null = null,
  subject: string | null = null,
): Contest {
  return { id, kind, scene, subject, who: [...who], stage: 'write', deadline, entries: [], votes: {}, winner: null, text: null, fill: false };
}

/** A player's text (writing again replaces it). False when it does not count. */
export function submitEntry(c: Contest, playerId: string, raw: unknown): boolean {
  const text = cleanEntry(raw);
  if (c.stage !== 'write' || !c.who.includes(playerId) || !text) return false;
  const mine = c.entries.find((e) => e.playerId === playerId);
  if (mine) mine.text = text;
  else c.entries.push({ id: `${c.id}#${c.entries.length + 1}`, playerId, text });
  return true;
}

/** A vote for someone else's entry. False when it does not count. */
export function castVote(c: Contest, playerId: string, entryId: string): boolean {
  const entry = c.entries.find((e) => e.id === entryId);
  if (c.stage !== 'vote' || !c.who.includes(playerId) || !entry || entry.playerId === playerId) return false;
  c.votes[playerId] = entryId;
  return true;
}

/** The entries a player may vote for. */
export const optionsFor = (c: Contest, playerId: string): Entry[] => c.entries.filter((e) => e.playerId !== playerId);

const finish = (c: Contest, entry: Entry) => {
  c.stage = 'done';
  c.winner = entry.id;
  c.text = entry.text;
};

/** Close the stage when everyone present has answered or its time is up (a closed write may close the vote too). */
export function advanceContest(c: Contest, now: number, present: ReadonlySet<string>, rng: Rng): void {
  const waiting = c.who.filter((id) => present.has(id));
  if (c.stage === 'write') {
    const everyone = waiting.every((id) => c.entries.some((e) => e.playerId === id));
    if (!everyone && now < c.deadline) return;
    if (c.entries.length === 0) {
      c.stage = 'done';
      c.fill = true;
      c.deadline = now + FILL_GRACE_S * 1000;
    } else if (c.entries.length === 1) finish(c, c.entries[0]);
    else if (c.who.length < MIN_VOTERS) finish(c, c.entries[Math.floor(rng() * c.entries.length)]);
    else {
      c.stage = 'vote';
      c.deadline = now + VOTE_SECONDS * 1000;
    }
  }
  if (c.stage === 'vote') {
    const everyone = waiting.every((id) => id in c.votes);
    if (!everyone && now < c.deadline) return;
    const tally = new Map(c.entries.map((e) => [e.id, 0]));
    for (const id of Object.values(c.votes)) tally.set(id, (tally.get(id) ?? 0) + 1);
    const top = Math.max(...tally.values());
    const tied = c.entries.filter((e) => tally.get(e.id) === top);
    finish(c, tied[Math.floor(rng() * tied.length)]);
  }
}

/** Whether the contest has a result to use. */
export const settled = (c: Contest): boolean => c.stage === 'done' && c.text !== null;

/** Supply a text for a contest nobody answered (the server's AI). False when it was not waiting for one. */
export function fillContest(c: Contest, text: string): boolean {
  const clean = cleanEntry(text);
  if (!c.fill || c.text !== null || !clean) return false;
  c.text = clean;
  c.fill = false;
  return true;
}

/** Past its wait, a contest nobody answered takes the fallback. */
export function expireFill(c: Contest, now: number, fallback: string): void {
  if (c.fill && c.text === null && now >= c.deadline) {
    c.text = cleanEntry(fallback) || '…';
    c.fill = false;
  }
}

/** Seconds-independent check used by the clock: is anything in this contest due? */
export const due = (c: Contest, now: number): boolean => (c.stage !== 'done' ? now >= c.deadline : c.fill && c.text === null && now >= c.deadline);

// ------------------------------------------------------------------ a room's contests
/** Close whatever stage is due, and let contests nobody answered fall back once their wait is over. */
export function advanceContests(contests: Contest[], now: number, present: ReadonlySet<string>, rng: Rng, fallback: (c: Contest) => string): void {
  for (const c of contests) {
    advanceContest(c, now, present, rng);
    expireFill(c, now, fallback(c));
  }
}

export const contestOf = (contests: readonly Contest[], id: string): Contest | undefined => contests.find((c) => c.id === id);

/** The decided text of a contest, or null while it is open. */
export const textOf = (contests: readonly Contest[], id: string): string | null => {
  const c = contestOf(contests, id);
  return c && settled(c) ? c.text : null;
};

/** Contests the server may fill in (nobody answered). */
export const unfilled = (contests: readonly Contest[]): Contest[] => contests.filter((c) => c.fill && c.text === null);

/** Is anything waiting on the clock? */
export const contestsDue = (contests: readonly Contest[], now: number): boolean => contests.some((c) => due(c, now));
