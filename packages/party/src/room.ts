// The room state machine: lobby → casting → playing (one turn per line) → compiling → show → lobby.
// `reduce()` is pure: the server feeds it every action (with the time and a seeded Rng) and broadcasts the result.

import { boardOf } from './board.ts';
import { advanceContests, CARD_SECONDS, castVote, cleanEntry, contestOf, contestsDue, fillContest, openContest, submitEntry, textOf } from './contest.ts';
import {
  assignWriters,
  blindScript,
  castRoles,
  charactersIn,
  linesIn,
  pickSlice,
  planLines,
  type SlicePlan,
  trailerMoments,
  turnSeconds,
  turnsOf,
} from './director.ts';
import {
  type Action,
  DEFAULT_SETTINGS,
  GAME_GENRES,
  isGameMode,
  isPartyLanguage,
  isWrittenMode,
  type LineView,
  MAX_PLAYERS,
  type PartyLine,
  type PlayerView,
  type Result,
  type Role,
  type Room,
  type RoomSettings,
} from './protocol.ts';
import type { Rng } from './rng.ts';
import { tasksFor } from './tasks.ts';
import { newTrailer, openPitch, startScene } from './trailer.ts';

export interface Env {
  /** epoch ms */
  now: number;
  rng: Rng;
}

/** An action that is not allowed right now; the server answers the sender with the message. */
export class RoomError extends Error {
  override name = 'RoomError';
}

/** Extra seconds granted while a take is uploading, so a slow Wi-Fi does not lose it. */
export const UPLOAD_GRACE_S = 30;
/** Time between the show being ready and everybody's picture starting, so every device is waiting for it. */
export const SHOW_LEAD_MS = 4000;

export function createRoom(code: string, seed: number): Room {
  return {
    code,
    phase: 'lobby',
    round: 0,
    settings: { ...DEFAULT_SETTINGS },
    players: [],
    clip: null,
    source: { characters: [], lines: [] },
    characters: [],
    lines: [],
    preparing: false,
    prepNote: '',
    projectId: null,
    slice: null,
    heard: {},
    suggestions: {},
    cast: [],
    result: null,
    contests: [],
    trailer: null,
    queue: [],
    turn: null,
    results: [],
    ambience: [],
    seed,
  };
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;

const cleanText = (v: unknown, max: number): string =>
  String(v ?? '')
    .replace(/\p{C}/gu, ' ')
    .trim()
    .slice(0, max);

export function cleanName(name: unknown): string {
  return String(name ?? '')
    .replace(/[\p{C}<>]/gu, '')
    .trim()
    .slice(0, 24);
}

/** Apply one action. Returns a new Room; throws RoomError when the action does not fit the current phase. */
export function reduce(prev: Room, action: Action, env: Env): Room {
  const r: Room = structuredClone(prev);
  apply(r, action, env);
  settleRoom(r, env);
  return r;
}

/** Whether the clock has something to do (a turn ran out of time, a contest stage ended): the server then sends a tick. */
export function needsTick(r: Room, now: number): boolean {
  if (r.phase === 'playing' && r.turn && now > r.turn.deadline) return true;
  return (r.phase === 'cards' || r.phase === 'pitch' || r.phase === 'playing') && contestsDue(r.contests, now);
}

function apply(r: Room, action: Action, env: Env): Room {
  switch (action.type) {
    // ---------------------------------------------------------------- people
    case 'join': {
      const name = cleanName(action.name);
      if (!name) throw new RoomError('Type your name');
      const known = r.players.find((p) => p.id === action.playerId);
      if (known) {
        known.name = name;
        known.connected = true;
      } else {
        if (r.players.length >= MAX_PLAYERS) throw new RoomError('The room is full');
        r.players.push({ id: action.playerId, name, connected: true, played: 0 });
      }
      return r;
    }
    case 'connection': {
      const p = r.players.find((x) => x.id === action.playerId);
      if (p) p.connected = action.connected;
      return r;
    }
    case 'kick': {
      r.players = r.players.filter((p) => p.id !== action.playerId);
      dropPlayer(r, action.playerId, env);
      return r;
    }
    case 'ambience':
      r.ambience = action.urls.slice(0, 50);
      return r;
    case 'heard': {
      if (!r.results.some((x) => x.cueId === action.cueId && x.file)) return r; // only takes of this round
      r.heard[action.cueId] = String(action.text).slice(0, 300);
      return r;
    }
    case 'suggestion': {
      if (!r.queue.includes(action.cueId) || r.results.some((x) => x.cueId === action.cueId)) return r; // too late
      r.suggestions[action.cueId] = String(action.text).slice(0, 300);
      return r;
    }

    // ---------------------------------------------------------------- setup
    case 'set-clip': {
      need(r, ['lobby', 'show'], 'Pick a clip between rounds');
      r.clip = action.clip;
      r.source = { characters: action.characters, lines: action.lines };
      resetRound(r);
      r.phase = 'lobby';
      return r;
    }
    case 'settings': {
      need(r, ['lobby', 'show'], 'Change the rules between rounds');
      const s = action.settings;
      const cur = r.settings;
      r.settings = {
        mode: isGameMode(s.mode) ? s.mode : cur.mode,
        premise: typeof s.premise === 'string' ? cleanText(s.premise, 160) || cur.premise : cur.premise,
        genre: (GAME_GENRES as readonly string[]).includes(s.genre ?? '') ? (s.genre as string) : cur.genre,
        language: isPartyLanguage(s.language) ? s.language : cur.language,
        maxCast: clampInt(s.maxCast, 1, 8, cur.maxCast),
        maxLines: clampInt(s.maxLines, 1, 60, cur.maxLines),
        scenes: clampInt(s.scenes, 2, 12, cur.scenes),
        turnSeconds: clampInt(s.turnSeconds, 10, 180, cur.turnSeconds),
        order: s.order === 'shuffle' || s.order === 'scene' ? s.order : cur.order,
        sliceSeconds: clampInt(s.sliceSeconds, 15, 600, cur.sliceSeconds),
        suggestions: typeof s.suggestions === 'boolean' ? s.suggestions : cur.suggestions,
        cards: typeof s.cards === 'boolean' ? s.cards : cur.cards,
      } satisfies RoomSettings;
      return r;
    }
    case 'cast': {
      need(r, ['lobby', 'show'], 'A round is already running');
      if (!r.clip) throw new RoomError('Pick a clip first');
      resetRound(r);
      const present = r.players.filter((p) => p.connected).length;
      if (!present) throw new RoomError('Nobody has joined yet');
      if (r.settings.mode === 'trailer') {
        castTrailer(r, action.projectId, env);
        return r;
      }
      // a slice of the scene sized for the players (or, blind, silent segments), then who plays whom
      const people = Math.min(r.settings.maxCast, present);
      const dur = r.clip.duration || Number.POSITIVE_INFINITY;
      const clamp = (x: SlicePlan | null) => (x ? { start: x.start, end: Math.min(x.end, dur) } : null);
      let slice: { start: number; end: number } | null;
      let inSlice: PartyLine[];
      let cast: Role[];
      if (r.settings.mode === 'blind') {
        // any stretch with talking in it: the players improvise over it, the characters do not matter
        slice =
          clamp(pickSlice(r.source.lines, { seconds: r.settings.sliceSeconds, players: 1 }, env.rng)) ??
          (r.clip.duration ? { start: 0, end: r.clip.duration } : null);
        if (!slice) throw new RoomError('This clip has no lines to play');
        const script = blindScript(slice, people, { maxLines: r.settings.maxLines });
        r.characters = script.characters;
        r.lines = script.lines;
        inSlice = script.lines;
        cast = castRoles(script.characters, r.players, people, env.rng);
        for (const role of cast) {
          const c = r.characters.find((x) => x.id === role.characterId);
          const p = r.players.find((x) => x.id === role.playerId);
          if (c && p) c.name = p.name; // a blind "character" is just the player's turn
        }
      } else {
        // every character in the slice is cast, the same number to each player
        const plan = pickSlice(r.lines, { seconds: r.settings.sliceSeconds, players: people, maxLines: r.settings.maxLines }, env.rng);
        slice = clamp(plan);
        inSlice = linesIn(r.lines, slice);
        r.characters = charactersIn(r.characters, inSlice);
        cast = plan ? castRoles(r.characters, r.players, plan.players, env.rng) : [];
        // the turns: one character's stretch each, tiling the slice, so takes never overlap
        if (slice) inSlice = turnsOf(inSlice, slice);
        r.lines = inSlice;
      }
      if (!cast.length) throw new RoomError('This clip has no lines to play');
      r.slice = slice;
      r.cast = cast;
      // the slice holds no more lines than the round allows: every turn in it is dubbed
      r.queue = planLines(inSlice, cast, { ...r.settings, maxLines: Math.max(r.settings.maxLines, inSlice.length) }, env.rng);
      // written games need their script before the first turn (the server writes it, then sends 'script')
      r.preparing = isWrittenMode(r.settings.mode);
      r.prepNote = '';
      r.projectId = action.projectId;
      r.round++;
      for (const id of new Set(cast.map((c) => c.playerId))) {
        const p = r.players.find((x) => x.id === id);
        if (p) p.played++;
      }
      r.phase = openCards(r, env) ? 'cards' : 'casting';
      return r;
    }
    case 'prep-note':
      if (r.preparing) r.prepNote = cleanText(action.note, 160);
      return r;
    case 'script': {
      need(r, ['casting', 'cards'], 'No round is being prepared');
      // written per subtitle line; a turn shows its lines, one per row
      for (const l of r.lines) {
        for (const part of l.parts ?? [l]) {
          const w = action.texts[part.cueId];
          if (w?.text?.trim()) part.text = cleanText(w.text, 300);
        }
        if (l.parts) l.text = l.parts.map((x) => x.text).join('\n');
      }
      r.preparing = false;
      r.prepNote = '';
      return r;
    }
    case 'begin': {
      need(r, ['casting'], 'Cast the round first');
      if (r.preparing) throw new RoomError('The script is still being written');
      if (r.trailer) {
        // the room first watches the clip and pitches the movie
        openPitch(r.contests, connectedIds(r), env.now);
        r.phase = 'pitch';
        return r;
      }
      r.phase = 'playing';
      nextTurn(r, env);
      return r;
    }

    // ---------------------------------------------------------------- the room writes and votes
    case 'submit': {
      const tr = r.trailer;
      if (action.task.startsWith('review:')) {
        const gap = Number(action.task.slice('review:'.length));
        const text = cleanEntry(action.text);
        const mayReview =
          !!tr &&
          r.phase === 'playing' &&
          tr.next - 1 === gap &&
          tr.scenes[tr.next]?.playerId === action.playerId &&
          tr.scenes[gap]?.playerId !== action.playerId;
        if (!tr || !mayReview || !text) throw new RoomError('Too late for that');
        const mine = tr.reviews.find((x) => x.gap === gap && x.playerId === action.playerId);
        if (mine) mine.text = text;
        else tr.reviews.push({ playerId: action.playerId, gap, text });
        return r;
      }
      const c = contestOf(r.contests, action.task);
      if (!c || !submitEntry(c, action.playerId, action.text)) throw new RoomError('Too late for that');
      return r;
    }
    case 'vote': {
      const c = contestOf(r.contests, action.task);
      if (!c || !castVote(c, action.playerId, action.entry)) throw new RoomError('Too late for that');
      return r;
    }
    case 'fill': {
      const c = contestOf(r.contests, action.task);
      if (c) fillContest(c, action.text);
      return r;
    }

    // ---------------------------------------------------------------- turns
    case 'status': {
      const turn = ownTurn(r, action.playerId, action.turn);
      turn.status = action.status;
      return r;
    }
    case 'pass': {
      ownTurn(r, action.playerId, action.turn);
      skipTurn(r, env);
      return r;
    }
    case 'uploading': {
      const turn = ownTurn(r, action.playerId, action.turn);
      turn.status = 'uploading';
      turn.deadline = Math.max(turn.deadline, env.now + UPLOAD_GRACE_S * 1000);
      return r;
    }
    case 'submitted': {
      const turn = ownTurn(r, action.playerId, action.turn);
      r.results.push({ cueId: turn.cueId, playerId: turn.playerId, file: action.file, start: action.start, duration: action.duration });
      nextTurn(r, env);
      return r;
    }
    case 'skip':
      need(r, ['playing'], 'Nobody is recording');
      skipTurn(r, env);
      return r;
    case 'extend': {
      need(r, ['playing'], 'Nobody is recording');
      if (r.turn) r.turn.deadline += clampInt(action.seconds, 1, 300, 15) * 1000;
      return r;
    }
    case 'tick':
      if (r.phase === 'playing' && r.turn && env.now > r.turn.deadline) skipTurn(r, env);
      return r;
    case 'finish':
      need(r, ['casting', 'pitch', 'playing'], 'No round is running');
      r.turn = null;
      r.phase = 'compiling';
      return r;
    case 'compiled':
      need(r, ['compiling'], 'Nothing to compile');
      r.result = action.result ? { file: action.result, startAt: env.now + SHOW_LEAD_MS } : null;
      r.phase = 'show';
      return r;
    case 'again':
      need(r, ['show', 'compiling', 'casting', 'pitch'], 'A round is running');
      resetRound(r);
      r.phase = 'lobby';
      return r;
  }
}

function need(r: Room, phases: Room['phase'][], message: string) {
  if (!phases.includes(r.phase)) throw new RoomError(message);
}

function resetRound(r: Room) {
  r.characters = structuredClone(r.source.characters);
  r.lines = structuredClone(r.source.lines);
  r.preparing = false;
  r.prepNote = '';
  r.slice = null;
  r.heard = {};
  r.suggestions = {};
  r.cast = [];
  r.result = null;
  r.contests = [];
  r.trailer = null;
  r.queue = [];
  r.results = [];
  r.turn = null;
  r.projectId = null;
}

const connectedIds = (r: Room): string[] => r.players.filter((p) => p.connected).map((p) => p.id);

/**
 * Cast a trailer: moments of the clip spread from start to end, each spoken by one character of the clip. Every
 * character in them is dealt to a player (the same number each, as in any round), and a scene is performed by whoever
 * plays its character: so a character keeps one voice through the trailer, and their card applies to all their scenes.
 * The movie is pitched when the host starts.
 */
function castTrailer(r: Room, projectId: string, env: Env) {
  const present = r.players.filter((p) => p.connected).length;
  if (present < 2) throw new RoomError('The trailer needs at least two players');
  const people = Math.min(r.settings.maxCast, present);
  const moments = trailerMoments(r.source.lines, Math.max(2, r.settings.scenes), env.rng, { variety: people });
  if (moments.length < 2) throw new RoomError('This clip has too few lines for a trailer');
  const lines: PartyLine[] = moments.map((m, i) => ({ cueId: `scene${i + 1}`, character: m.character, start: m.start, end: m.end, text: '' }));
  const characters = charactersIn(r.source.characters, lines).filter((c) => c.lines > 0);
  const cast = castRoles(characters, r.players, people, env.rng);
  const playerOf = (character: string) => cast.find((c) => c.characterId === character)?.playerId ?? '';
  r.characters = characters;
  r.lines = lines;
  r.cast = cast;
  r.queue = lines.map((l) => l.cueId);
  r.trailer = newTrailer(lines.map((l) => ({ cueId: l.cueId, character: l.character, playerId: playerOf(l.character), direction: null })));
  r.slice = null;
  r.preparing = false;
  r.prepNote = '';
  r.projectId = projectId;
  r.round++;
  for (const id of new Set(cast.map((c) => c.playerId))) {
    const p = r.players.find((x) => x.id === id);
    if (p) p.played++;
  }
  r.phase = openCards(r, env) ? 'cards' : 'casting';
}

/** Does this round start by describing its characters? (Blind dubbing has none; the trailer always does.) */
const wantsCards = (r: Room): boolean => r.settings.mode !== 'blind' && (r.settings.mode === 'trailer' || r.settings.cards);

/**
 * Each character of the round is described by one player (voice and personality), going round the players in random
 * order, blind to who will play the character: the cast is revealed only afterwards. False when the round has no cards.
 */
function openCards(r: Room, env: Env): boolean {
  if (!wantsCards(r)) return false;
  const writers = assignWriters(r.characters, r.players, env.rng);
  for (const c of r.characters) {
    const writer = writers.get(c.id);
    if (writer) r.contests.push(openContest(`card:${c.id}`, 'card', [writer], env.now + CARD_SECONDS * 1000, null, c.id));
  }
  return r.contests.length > 0;
}

/**
 * After every action: close the contest stages that are due and carry decisions to where they are used (a card onto
 * its character, a direction into its scene, the title), then move the round on: the cast is revealed once every card
 * is in, the trailer's pitch starts its first scene, a scene waiting for its direction starts when it arrives, and the
 * trailer is put together once the title is in.
 */
function settleRoom(r: Room, env: Env) {
  if (!r.contests.length) return;
  const tr = r.trailer;
  const clip = r.clip?.name ?? '';
  const nameOf = (id: string | null) => r.characters.find((c) => c.id === id)?.name ?? clip;
  const fingerprint = () =>
    `${r.phase}|${r.turn?.n ?? 0}|${tr?.next ?? 0}|${tr?.holding ?? ''}|${r.contests.map((c) => `${c.stage}${c.text ?? ''}`).join(',')}`;
  // a step can open the next contest, which may itself be closed at once (nobody to ask): go on until nothing moves
  for (let i = 0, last = ''; i < 8 && (r.phase === 'cards' || r.phase === 'pitch' || r.phase === 'playing') && last !== fingerprint(); i++) {
    last = fingerprint();
    const fallback = (c: (typeof r.contests)[number]) => (c.kind === 'direction' ? (tr?.logline ?? clip) : c.kind === 'card' ? nameOf(c.subject) : clip);
    advanceContests(r.contests, env.now, new Set(connectedIds(r)), env.rng, fallback);
    for (const c of r.contests) {
      const text = textOf(r.contests, c.id);
      if (text === null) continue;
      if (c.kind === 'card') {
        const ch = r.characters.find((x) => x.id === c.subject);
        if (ch && text !== ch.name) ch.card = text;
      }
      if (tr && c.kind === 'direction' && c.scene !== null && tr.scenes[c.scene]?.direction === null) tr.scenes[c.scene].direction = text;
      if (tr && c.kind === 'title' && tr.title === null) tr.title = text;
    }
    if (r.phase === 'cards') {
      if (r.contests.filter((c) => c.kind === 'card').every((c) => textOf(r.contests, c.id) !== null)) r.phase = 'casting';
      continue;
    }
    if (!tr) continue;
    const pitch = r.phase === 'pitch' ? textOf(r.contests, 'pitch') : null;
    if (pitch !== null) {
      tr.logline = pitch;
      if (tr.scenes[0]) tr.scenes[0].direction = pitch;
      r.phase = 'playing';
      nextTurn(r, env);
    } else if (r.phase === 'playing' && !r.turn && tr.holding) nextTurn(r, env);
  }
}

function ownTurn(r: Room, playerId: string, n: number) {
  if (r.phase !== 'playing' || !r.turn || r.turn.n !== n || r.turn.playerId !== playerId) throw new RoomError('It is not your turn');
  return r.turn;
}

function skipTurn(r: Room, env: Env) {
  if (!r.turn) return;
  const line = lineOf(r, r.turn.cueId);
  r.results.push({ cueId: r.turn.cueId, playerId: r.turn.playerId, file: null, start: line?.start ?? 0, duration: 0 });
  nextTurn(r, env);
}

/** Call the next line, or move to compiling when every line has had its turn. */
function nextTurn(r: Room, env: Env) {
  if (r.trailer) return nextScene(r, r.trailer, env);
  const n = (r.turn?.n ?? 0) + 1;
  const done = new Set(r.results.map((x) => x.cueId));
  const cueId = r.queue.find((c) => !done.has(c));
  const line = cueId ? lineOf(r, cueId) : undefined;
  const role = line && r.cast.find((c) => c.characterId === line.character);
  if (!cueId || !line || !role) {
    r.turn = null;
    r.phase = 'compiling';
    return;
  }
  r.turn = { n, playerId: role.playerId, cueId, status: 'called', deadline: env.now + turnSeconds(line, r.settings.turnSeconds) * 1000 };
}

/**
 * The trailer's next scene goes to the stage, once its direction is in. The room starts on what the scene after it
 * needs, so it is written while this one is recorded. After the last scene the trailer waits for its title.
 */
function nextScene(r: Room, tr: NonNullable<Room['trailer']>, env: Env) {
  const scene = tr.scenes[tr.next];
  r.turn = null;
  if (!scene) {
    tr.holding = !tr.title;
    if (tr.title) r.phase = 'compiling';
    return;
  }
  const line = lineOf(r, scene.cueId);
  if (!line) {
    tr.next++; // a scene without a picture cannot be played
    return nextScene(r, tr, env);
  }
  tr.holding = scene.direction === null;
  if (tr.holding) return;
  const deadline = env.now + turnSeconds(line, r.settings.turnSeconds) * 1000;
  r.turn = { n: tr.next + 1, playerId: scene.playerId, cueId: scene.cueId, status: 'called', deadline };
  startScene(tr, r.contests, tr.next, connectedIds(r), env.now, deadline);
  tr.next++;
}

/** A player left for good: their lines keep the original voice. */
function dropPlayer(r: Room, playerId: string, env: Env) {
  const tr = r.trailer;
  if (tr) {
    // the characters of the player who left go to the other performers in turn: the scenes still to come follow them
    const others = r.players.filter((p) => p.id !== playerId && r.cast.some((c) => c.playerId === p.id));
    for (const [i, role] of r.cast.filter((c) => c.playerId === playerId).entries()) {
      const to = others[i % (others.length || 1)];
      if (!to) continue;
      role.playerId = to.id;
      for (const [k, scene] of tr.scenes.entries()) if (k >= tr.next && scene.character === role.characterId) scene.playerId = to.id;
    }
    if (r.phase === 'playing' && r.turn?.playerId === playerId) nextTurn(r, env);
    return;
  }
  const roles = r.cast.filter((c) => c.playerId === playerId).map((c) => c.characterId);
  if (!roles.length) return;
  r.cast = r.cast.filter((c) => c.playerId !== playerId);
  const gone = new Set(r.lines.filter((l) => roles.includes(l.character)).map((l) => l.cueId));
  r.queue = r.queue.filter((c) => !gone.has(c));
  if (r.phase === 'playing' && r.turn?.playerId === playerId) {
    r.turn = null;
    nextTurn(r, env);
  }
}

const lineOf = (r: Room, cueId: string): PartyLine | undefined => r.lines.find((l) => l.cueId === cueId);

// ------------------------------------------------------------------ views
/** What one phone may see: its own parts and lines, but not other players' scripts. */
export function playerView(r: Room, playerId: string, { isHost = false, joinUrl = '' }: { isHost?: boolean; joinUrl?: string } = {}): PlayerView {
  const me = r.players.find((p) => p.id === playerId) ?? null;
  const charOf = (id: string) => r.characters.find((c) => c.id === id);
  const nameOf = (id: string) => r.players.find((p) => p.id === id)?.name ?? '?';
  const lineView = (l: PartyLine | undefined): LineView | null => {
    if (!l) return null;
    const c = charOf(l.character);
    const heard = r.heard[l.cueId];
    // blind dubbing: the previous segment's take, so the next player hears how it ended
    const take = r.settings.mode === 'blind' ? r.results.find((x) => x.cueId === l.cueId)?.file : undefined;
    return {
      ...l,
      characterName: c?.name ?? '?',
      color: c?.color ?? '#888',
      ...(c?.card ? { card: c.card } : {}),
      ...(heard ? { heard } : {}),
      ...(take ? { take } : {}),
    };
  };
  const turn = r.turn;
  const turnLine = turn ? lineOf(r, turn.cueId) : undefined;
  const turnChar = turnLine ? charOf(turnLine.character) : undefined;
  const mine = !!turn && turn.playerId === playerId;
  const tr = r.trailer;
  const script = [...r.lines].sort((a, b) => a.start - b.start);
  const at = mine && turnLine ? script.findIndex((l) => l.cueId === turnLine.cueId) : -1;
  return {
    role: 'player',
    code: r.code,
    phase: r.phase,
    mode: r.settings.mode,
    round: r.round,
    me,
    players: r.players.map(({ id, name, connected }) => ({ id, name, connected })),
    clip: r.clip,
    projectId: r.projectId,
    inRound: r.cast.some((c) => c.playerId === playerId),
    mine: (r.phase === 'cards' ? [] : r.cast) // the characters stay hidden while they are being described
      .filter((c) => c.playerId === playerId)
      .map((c) => charOf(c.characterId))
      .filter((c) => c !== undefined),
    cast: (r.phase === 'cards' ? [] : r.cast).map((c) => ({
      player: nameOf(c.playerId),
      character: charOf(c.characterId)?.name ?? '?',
      color: charOf(c.characterId)?.color ?? '#888',
    })),
    turn: turn
      ? {
          n: turn.n,
          player: nameOf(turn.playerId),
          character: turnChar?.name ?? '?',
          color: turnChar?.color ?? '#888',
          status: turn.status,
          deadline: turn.deadline,
          mine,
        }
      : null,
    line:
      mine && turnLine
        ? {
            ...(lineView(turnLine) as LineView),
            ...(r.suggestions[turnLine.cueId] ? { suggestion: r.suggestions[turnLine.cueId] } : {}),
            ...(tr?.scenes.find((x) => x.cueId === turnLine.cueId)?.direction
              ? { direction: tr.scenes.find((x) => x.cueId === turnLine.cueId)?.direction ?? '' }
              : {}),
          }
        : null,
    context: { before: at > 0 ? lineView(script[at - 1]) : null, after: at >= 0 ? lineView(script[at + 1]) : null },
    progress: { done: r.results.length, total: r.queue.length },
    ambience: r.ambience,
    tasks: tasksFor(r, playerId),
    isHost,
    board: boardOf(r),
    joinUrl,
  };
}

/** Lines that got a take, for compiling the round. */
export const recorded = (r: Room): (Result & { file: string })[] => r.results.filter((x): x is Result & { file: string } => !!x.file);
