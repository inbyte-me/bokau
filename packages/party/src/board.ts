// The public board: everything a screen shows about a room and nothing a player must not see. The server builds it
// from the room and sends the same board to every client (a TV, a phone host, a phone player), so a client draws
// what the room is doing without being the one that runs it. No secrets: a scene's direction stays off it, character
// cards stay off it until the cast is revealed, and the words of a contest are on it only where everyone may read them.
import type { Contest } from './contest.ts';
import { type ClipInfo, type GameMode, type PartyCharacter, type Phase, playerColor, type Room, type RoomSettings, type TurnStatus } from './protocol.ts';

export interface BoardPlayer {
  id: string;
  name: string;
  connected: boolean;
  color: string;
}

export interface BoardCharacter {
  id: string;
  name: string;
  color: string;
  lines: number;
  /** only once the cast is revealed */
  card?: string;
}

export interface BoardContest {
  id: string;
  kind: Contest['kind'];
  stage: Contest['stage'];
  /** epoch ms: when the stage ends */
  deadline: number;
  /** nobody answered: the server is finding a text */
  waiting: boolean;
  /** the character it is about */
  subject: { name: string; color: string } | null;
  /** the scene it is for (directions) */
  scene: number | null;
  /** who writes, and whether they have */
  writers: { playerId: string; done: boolean }[];
  /** the texts and who voted for each (only where everyone may read them; otherwise just how many there are) */
  entries: { id: string; text: string; votes: string[] }[] | null;
  entryCount: number;
  /** the result once decided, where everyone may read it */
  text: string | null;
  /** who wrote the winning text */
  by: string | null;
}

export interface BoardDot {
  id: string;
  color: string;
  state: 'done' | 'skipped' | 'now' | 'next';
}

export interface Board {
  code: string;
  phase: Phase;
  mode: GameMode;
  round: number;
  settings: RoomSettings;
  clip: ClipInfo | null;
  /** the round's project (its picture and takes are served to the room's members) */
  projectId: string | null;
  players: BoardPlayer[];
  /** the characters of the round (cards shown once the cast is revealed) */
  characters: BoardCharacter[];
  /** who plays whom: empty while the characters are being described */
  cast: { playerId: string; characterId: string }[];
  preparing: boolean;
  prepNote: string;
  slice: { start: number; end: number } | null;
  /** the turn on stage */
  turn: { n: number; playerId: string; characterId: string | null; status: TurnStatus; deadline: number } | null;
  progress: { done: number; total: number; recorded: number };
  dots: BoardDot[];
  contests: BoardContest[];
  trailer: {
    logline: string | null;
    title: string | null;
    scenes: number;
    next: number;
    holding: boolean;
    critic: { playerId: string; done: boolean } | null;
  } | null;
  /** the finished round, rendered: what every client plays at `startAt` (server clock, epoch ms) */
  result: { file: string; startAt: number } | null;
}

/** Contests whose words everyone may read (a direction is a surprise to the one who performs it; a card to its player). */
const READABLE: Contest['kind'][] = ['pitch', 'title'];

export function boardOf(r: Room): Board {
  const revealed = r.phase !== 'cards';
  const characterOf = (id: string | null | undefined): PartyCharacter | undefined => r.characters.find((c) => c.id === id);
  const turnLine = r.turn ? r.lines.find((l) => l.cueId === r.turn?.cueId) : undefined;
  const tr = r.trailer;
  const next = tr?.scenes[tr.next];
  const contest = (c: Contest): BoardContest => {
    const open = c.stage !== 'done';
    const readable = READABLE.includes(c.kind);
    const winner = c.entries.find((e) => e.id === c.winner);
    const subject = c.kind === 'card' ? characterOf(c.subject) : undefined;
    return {
      id: c.id,
      kind: c.kind,
      stage: c.stage,
      deadline: c.deadline,
      waiting: c.fill && c.text === null,
      subject: subject ? { name: subject.name, color: subject.color } : null,
      scene: c.scene,
      writers: c.who.map((playerId) => ({ playerId, done: c.entries.some((e) => e.playerId === playerId) })),
      entries:
        readable && c.stage === 'vote'
          ? c.entries.map((e) => ({
              id: e.id,
              text: e.text,
              votes: Object.entries(c.votes)
                .filter(([, id]) => id === e.id)
                .map(([v]) => v),
            }))
          : null,
      entryCount: c.entries.length,
      text: readable && !open ? c.text : null,
      by: readable && winner ? winner.playerId : null,
    };
  };
  return {
    code: r.code,
    phase: r.phase,
    mode: r.settings.mode,
    round: r.round,
    settings: r.settings,
    clip: r.clip,
    projectId: r.projectId,
    players: r.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected, color: playerColor(r, p.id) })),
    characters: r.characters.map(({ id, name, color, lines, card }) => ({ id, name, color, lines, ...(revealed && card ? { card } : {}) })),
    cast: revealed ? r.cast.map(({ playerId, characterId }) => ({ playerId, characterId })) : [],
    preparing: r.preparing,
    prepNote: r.prepNote,
    slice: r.slice,
    turn: r.turn
      ? { n: r.turn.n, playerId: r.turn.playerId, characterId: turnLine?.character ?? null, status: r.turn.status, deadline: r.turn.deadline }
      : null,
    progress: { done: r.results.length, total: r.queue.length, recorded: r.results.filter((x) => x.file).length },
    dots: r.queue.map((id) => {
      const l = r.lines.find((x) => x.cueId === id);
      const role = r.cast.find((c) => c.characterId === l?.character);
      const done = r.results.find((x) => x.cueId === id);
      return {
        id,
        color: role ? playerColor(r, role.playerId) : '#888',
        state: done ? (done.file ? 'done' : 'skipped') : id === r.turn?.cueId ? 'now' : 'next',
      };
    }),
    contests: r.contests.map(contest),
    trailer: tr
      ? {
          logline: tr.logline,
          title: tr.title,
          scenes: tr.scenes.length,
          next: tr.next,
          holding: tr.holding,
          critic:
            next && tr.next > 0 && tr.scenes[tr.next - 1]?.playerId !== next.playerId
              ? { playerId: next.playerId, done: tr.reviews.some((x) => x.gap === tr.next - 1) }
              : null,
        }
      : null,
    result: r.result,
  };
}
