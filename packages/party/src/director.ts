// Who plays whom, and which lines get recorded in what order. Pure functions over a seeded Rng.
import type { PartyCharacter, PartyLine, Player, Role, RoomSettings } from './protocol.ts';
import { type Rng, shuffle } from './rng.ts';

/** Colours for characters made up for a round (a blind segment's player, a trailer performer). */
const MADE_UP_COLORS = ['#ff6b6b', '#4dd4ac', '#ffd166', '#6aa6ff', '#c792ea', '#ff9f68', '#9bb86f', '#c78fa5'];

/** `count` of the connected players, whoever has played least first (ties at random), in random order. */
export function pickPeople(players: readonly Player[], count: number, rng: Rng): Player[] {
  const present = players.filter((p) => p.connected);
  return shuffle(
    shuffle(present, rng)
      .sort((a, b) => a.played - b.played)
      .slice(0, Math.max(0, count)),
    rng,
  );
}

/**
 * Give every character of the slice to one of `players` people, the same number of characters each (the slice is
 * picked so the characters divide evenly). People: whoever has played least goes first, ties broken at random.
 * Characters are dealt from the most talkative down in a snake order (1-2-3-3-2-1…), so line counts stay close.
 */
export function castRoles(characters: readonly PartyCharacter[], players: readonly Player[], count: number, rng: Rng): Role[] {
  const speaking = characters.filter((c) => c.lines > 0);
  const present = players.filter((p) => p.connected);
  const k = Math.min(Math.max(1, count), speaking.length, present.length);
  if (k === 0) return [];
  const people = pickPeople(players, k, rng);
  const chars = shuffle(speaking, rng).sort((a, b) => b.lines - a.lines);
  return chars.map((c, i) => {
    const lap = Math.floor(i / k);
    const at = i % k;
    return { playerId: people[lap % 2 ? k - 1 - at : at].id, characterId: c.id };
  });
}

/**
 * The lines of this round: the cast characters' lines, taken round-robin so everyone gets a turn before anyone
 * gets a second, capped at `maxLines`, then put in scene order (or shuffled).
 */
export function planLines(lines: readonly PartyLine[], cast: readonly Role[], settings: Pick<RoomSettings, 'maxLines' | 'order'>, rng: Rng): string[] {
  const byChar = new Map<string, PartyLine[]>();
  for (const r of cast) byChar.set(r.characterId, []);
  for (const l of [...lines].sort((a, b) => a.start - b.start)) byChar.get(l.character)?.push(l);
  const picked: PartyLine[] = [];
  const max = Math.max(1, settings.maxLines);
  for (let i = 0; picked.length < max; i++) {
    let any = false;
    for (const list of byChar.values()) {
      if (i < list.length && picked.length < max) {
        picked.push(list[i]);
        any = true;
      }
    }
    if (!any) break;
  }
  const ordered = settings.order === 'shuffle' ? shuffle(picked, rng) : picked.sort((a, b) => a.start - b.start);
  return ordered.map((l) => l.cueId);
}

/** Seconds a player gets for one line: the base time plus three times the line's length. */
export const turnSeconds = (line: Pick<PartyLine, 'start' | 'end'>, base: number): number => Math.round(base + 3 * Math.max(0, line.end - line.start));

/** A stretch of the clip for one round, and how many people it is meant for. */
export interface SlicePlan {
  start: number;
  end: number;
  /** players the slice is for: its character count is a multiple of this */
  players: number;
}

/** Characters one player may voice in a round: more is chaos, not comedy. */
export const MAX_PARTS_EACH = 3;

/**
 * The stretch of the clip a round plays, which is also everything the result keeps:
 *  - at most `seconds` long, and at most `maxLines` lines, so every line in it gets dubbed;
 *  - its number of characters is a multiple of the number of players, so everyone voices the same number of parts
 *    (at most MAX_PARTS_EACH each); when no stretch fits everyone, it is planned for one player fewer, and so on;
 *  - preferably where no two characters talk over each other, so each turn holds one voice;
 *  - among those, where the dialogue is densest and most characters talk to each other, filling the time.
 * One of the best few is picked at random, so rounds on the same clip differ. The whole clip is a stretch like any
 * other: when it qualifies, it can be the slice.
 */
export function pickSlice(
  lines: readonly PartyLine[],
  { seconds, players, maxLines = Number.POSITIVE_INFINITY }: { seconds: number; players: number; maxLines?: number },
  rng: Rng,
): SlicePlan | null {
  const sorted = [...lines].sort((a, b) => a.start - b.start);
  if (!sorted.length) return null;
  // every stretch of consecutive lines that fits the time and the line budget
  const windows: { i: number; j: number; end: number; voices: number; score: number; crosstalk: boolean }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const ends = new Map<string, number>(); // character -> latest end so far
    let end = 0;
    let crosstalk = false;
    for (let j = i; j < sorted.length && j - i < maxLines; j++) {
      const l = sorted[j];
      end = Math.max(end, l.end);
      if (end - sorted[i].start > seconds) break;
      // two characters talking over each other: a turn boundary would cut one of them
      for (const [c, e] of ends) if (c !== l.character && e - l.start > 0.3) crosstalk = true;
      ends.set(l.character, Math.max(ends.get(l.character) ?? 0, l.end));
      const n = j - i + 1;
      // lines matter, a conversation matters more (a monologue scores low), and so does filling the time
      const score = n + (ends.size >= 2 ? 3 * ends.size : 0) + (4 * (end - sorted[i].start)) / seconds;
      windows.push({ i, j, end, voices: ends.size, score, crosstalk });
    }
  }
  for (let p = Math.max(1, players); p >= 1; p--) {
    const even = windows.filter((w) => w.voices % p === 0 && w.voices / p <= MAX_PARTS_EACH);
    // prefer stretches where nobody talks over anybody (every turn then holds one voice only)
    const clean = even.filter((w) => !w.crosstalk);
    const fit = maximal(clean.length ? clean : even);
    if (!fit.length) continue;
    fit.sort((a, b) => b.score - a.score);
    const best = fit.filter((w) => w.score >= fit[0].score * 0.85).slice(0, 4);
    const w = best[Math.floor(rng() * best.length)];
    // a second of air on each side, but never into a neighbouring line (it would play undubbed)
    const before = w.i > 0 ? Math.max(...sorted.slice(0, w.i).map((l) => l.end)) : 0;
    const after = w.j + 1 < sorted.length ? sorted[w.j + 1].start : Number.POSITIVE_INFINITY;
    const start = Math.max(0, Math.min(sorted[w.i].start, Math.max(before, sorted[w.i].start - 1)));
    const end = Math.max(w.end, Math.min(after, w.end + 1));
    return { start, end, players: p };
  }
  return null;
}

/** Drop a stretch when a longer one with as many characters contains it (one line short of a scene is no better). */
function maximal<W extends { i: number; j: number; voices: number }>(windows: W[]): W[] {
  const out: W[] = [];
  const byVoices = Map.groupBy(windows, (w) => w.voices);
  for (const group of byVoices.values()) {
    let reach = -1;
    for (const w of group.sort((a, b) => a.i - b.i || b.j - a.j)) {
      if (w.j <= reach) continue; // inside an earlier, longer stretch
      reach = w.j;
      out.push(w);
    }
  }
  return out;
}

/**
 * The turns of a round: one character's stretch each, so a player dubs one character at a time. Consecutive lines
 * of the same character are one turn; turns tile the slice without overlapping (each boundary sits halfway across
 * the gap, or the overlap, between two characters; the first and last reach the slice's edges).
 */
export function turnsOf(lines: readonly PartyLine[], slice: { start: number; end: number }): PartyLine[] {
  const groups: PartyLine[][] = [];
  for (const l of [...lines].sort((a, b) => a.start - b.start)) {
    const g = groups.at(-1);
    if (g && g[0].character === l.character) g.push(l);
    else groups.push([l]);
  }
  const lastEnd = (g: PartyLine[]) => Math.max(...g.map((l) => l.end));
  const cut = (a: PartyLine[], b: PartyLine[]) => (lastEnd(a) + b[0].start) / 2;
  return groups.map((g, i) => {
    const start = i > 0 ? cut(groups[i - 1], g) : Math.min(slice.start, g[0].start);
    const end = i + 1 < groups.length ? cut(g, groups[i + 1]) : Math.max(slice.end, lastEnd(g));
    const parts = g.map(({ cueId, start, end, text }) => ({ cueId, start, end, text }));
    return { cueId: g[0].cueId, character: g[0].character, start, end: Math.max(end, start + 0.1), text: parts.map((x) => x.text).join('\n'), parts };
  });
}

/** Lines that fall inside a slice. */
export const linesIn = (lines: readonly PartyLine[], slice: { start: number; end: number } | null): PartyLine[] =>
  slice ? lines.filter((l) => l.start >= slice.start && l.end <= slice.end) : [...lines];

/** Characters with their line counts inside a set of lines. */
export const charactersIn = (characters: readonly PartyCharacter[], lines: readonly PartyLine[]): PartyCharacter[] =>
  characters.map((c) => ({ ...c, lines: lines.filter((l) => l.character === c.id).length }));

/**
 * Blind dubbing's script: the slice cut into silent segments of about `segmentSeconds` (a multiple of `voices`), dealt
 * round-robin to `voices` placeholder characters (one per cast player; the reducer names them after the players).
 */
export function blindScript(
  slice: { start: number; end: number },
  voices: number,
  { segmentSeconds = 7, maxLines = 12 }: { segmentSeconds?: number; maxLines?: number } = {},
): { characters: PartyCharacter[]; lines: PartyLine[] } {
  const len = slice.end - slice.start;
  // a multiple of the players, so everyone gets the same number of turns
  const wanted = Math.min(maxLines, Math.max(2, Math.round(len / segmentSeconds)));
  const n = Math.max(voices, Math.floor(wanted / voices) * voices);
  const characters = Array.from({ length: voices }, (_, i) => ({
    id: `blind${i + 1}`,
    name: String(i + 1),
    color: MADE_UP_COLORS[i % MADE_UP_COLORS.length],
    lines: 0,
  }));
  const lines = Array.from({ length: n }, (_, i) => ({
    cueId: `seg${i + 1}`,
    character: characters[i % voices].id,
    start: slice.start + (len * i) / n,
    end: slice.start + (len * (i + 1)) / n,
    text: '',
  }));
  for (const c of characters) c.lines = lines.filter((l) => l.character === c.id).length;
  return { characters, lines };
}

/**
 * The moments of a trailer: short stretches where one character speaks, spread over the whole clip so the trailer
 * runs from its start to its end. `count` of them (fewer when the clip has fewer), in clip order, none touching another
 * or running into a line nobody dubs. Where a character talks on, the moment is cut at `maxSeconds`.
 */
export function trailerMoments(
  lines: readonly PartyLine[],
  count: number,
  rng: Rng,
  { minSeconds = 2.5, maxSeconds = 8, pad = 0.4, variety = 1 }: { minSeconds?: number; maxSeconds?: number; pad?: number; variety?: number } = {},
): { start: number; end: number; character: string }[] {
  const sorted = [...lines].sort((a, b) => a.start - b.start);
  // one character's stretches, cut into chunks that fit
  const chunks: { first: number; last: number }[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].character === sorted[i].character && sorted[j + 1].end - sorted[i].start <= maxSeconds) j++;
    chunks.push({ first: i, last: j });
    i = j + 1;
  }
  const moments = chunks.map(({ first, last }) => {
    const start = sorted[first].start;
    const end = Math.max(...sorted.slice(first, last + 1).map((l) => l.end));
    const before = first > 0 ? Math.max(...sorted.slice(0, first).map((l) => l.end)) : 0;
    const after = last + 1 < sorted.length ? sorted[last + 1].start : Number.POSITIVE_INFINITY;
    // a little air around the words, never past the middle of the gap to the neighbour
    let from = Math.max(start - pad, Math.min(start, (before + start) / 2));
    let to = Math.min(end + pad, Math.max(end, Number.isFinite(after) ? (end + after) / 2 : end + pad));
    // a very short exchange gets what room there is up to the neighbours, so it can be seen
    const missing = minSeconds - (to - from);
    if (missing > 0) {
      from = Math.max(before, from - missing / 2, 0);
      to = Math.min(after, to + missing / 2);
    }
    return { start: from, end: Math.max(to, from + 0.2), character: sorted[first].character };
  });
  // neighbours that grew into each other meet halfway
  for (let i = 1; i < moments.length; i++) {
    const a = moments[i - 1];
    const b = moments[i];
    if (a.end > b.start) a.end = b.start = (a.end + b.start) / 2;
  }
  if (moments.length <= count) return moments;
  // one from each equal share of the moments, at random inside it, so rounds differ but the story is covered
  const picked = Array.from({ length: Math.max(1, count) }, (_, i) => {
    const lo = Math.floor((i * moments.length) / count);
    const hi = Math.max(lo + 1, Math.floor(((i + 1) * moments.length) / count));
    return moments[lo + Math.floor(rng() * (hi - lo))];
  });
  // `variety`: at least this many different characters (when the clip has them), so every performer has someone to play;
  // a missing character takes the place of the pick nearest to it that repeats another
  const wanted = Math.min(variety, new Set(moments.map((m) => m.character)).size);
  for (let guard = 0; guard < moments.length && new Set(picked.map((m) => m.character)).size < wanted; guard++) {
    const have = new Set(picked.map((m) => m.character));
    const repeats = picked.filter((m) => picked.filter((x) => x.character === m.character).length > 1);
    const missing = moments.filter((m) => !have.has(m.character));
    let best: { at: number; by: (typeof moments)[number]; dist: number } | null = null;
    for (const by of missing) {
      for (const rep of repeats) {
        const dist = Math.abs(rep.start - by.start);
        if (!best || dist < best.dist) best = { at: picked.indexOf(rep), by, dist };
      }
    }
    if (!best) break;
    picked[best.at] = best.by;
  }
  return picked.sort((a, b) => a.start - b.start);
}

/** Who describes which character: the characters go round the connected players in random order (blind to who will play them). */
export function assignWriters(characters: readonly PartyCharacter[], players: readonly Player[], rng: Rng): Map<string, string> {
  const writers = shuffle(
    players.filter((p) => p.connected),
    rng,
  );
  return new Map(writers.length ? characters.map((c, i) => [c.id, writers[i % writers.length].id] as const) : []);
}
