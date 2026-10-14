// The party room's data and the messages exchanged over the room's WebSocket.
// The server holds the only real Room; the TV (host) and every phone (player) receive views of it.

import type { Board } from './board.ts';
import type { Contest } from './contest.ts';
import type { TaskView } from './tasks.ts';
import type { TrailerState } from './trailer.ts';

/** cards: the players describe the round's characters (before the cast is revealed); pitch: the trailer game's */
export type Phase = 'lobby' | 'cards' | 'casting' | 'pitch' | 'playing' | 'compiling' | 'show';

export interface PartyCharacter {
  /** speaker id in the clip */
  id: string;
  name: string;
  color: string;
  /** number of lines (cues) this character speaks */
  lines: number;
  /** the voice and personality a player gave this character, whoever ends up playing them */
  card?: string;
}

/** One line of the script, as the game sees it. */
export interface PartyLine {
  cueId: string;
  /** speaker id */
  character: string;
  start: number;
  end: number;
  text: string;
  /**
   * A turn: the subtitle lines it covers (one character speaking until someone else does). The turn's own range
   * tiles the slice with its neighbours, so turns never overlap; `text` is the parts' text, one per line.
   */
  parts?: { cueId: string; start: number; end: number; text: string }[];
}

export interface Player {
  id: string;
  name: string;
  connected: boolean;
  /** rounds this player has been cast in (casting prefers people who have played less) */
  played: number;
}

export interface Role {
  playerId: string;
  characterId: string;
}

export type TurnStatus = 'called' | 'recording' | 'reviewing' | 'uploading';

export interface Turn {
  /** increases with every turn; a submit must name the turn it answers */
  n: number;
  playerId: string;
  cueId: string;
  status: TurnStatus;
  /** epoch ms; the line is skipped (the original voice stays) when it passes */
  deadline: number;
}

export interface Result {
  cueId: string;
  playerId: string;
  /** take file in the round's project; null when the line was skipped */
  file: string | null;
  start: number;
  duration: number;
}

/**
 * What a round plays. dub: the scene's own lines. badlip: new lines written to fit the mouths, about a premise.
 * telenovela / genre: the scene's lines rewritten in a style. blind: silent stretches of the scene, improvised; each
 * player hears only the last second of the previous take. trailer: the room pitches a movie about the clip, every scene
 * is directed by the others while it waits, and the result is a trailer with a title and critics' quotes.
 * In every mode the result stays hidden until the show.
 */
export const GAME_MODES = ['dub', 'badlip', 'telenovela', 'genre', 'blind', 'trailer'] as const;
export type GameMode = (typeof GAME_MODES)[number];
export const isGameMode = (m: unknown): m is GameMode => GAME_MODES.includes(m as GameMode);
/** The games whose script is written by the AI before the first turn. */
export const isWrittenMode = (m: GameMode): boolean => m === 'badlip' || m === 'telenovela' || m === 'genre';
/** The games where the player invents what to say over a silent scene (no script to read). */
export const isImprovMode = (m: GameMode): boolean => m === 'blind' || m === 'trailer';
/** genres for the genre swap (ids match the AI prompts) */
export const GAME_GENRES = ['noir', 'pirate', 'corporate', 'action80s'] as const;

/** Languages a party can be played in (the speech model and the line writers handle these well). */
export const PARTY_LANGUAGES = ['en', 'es', 'fr', 'pt', 'de', 'it'] as const;
export type PartyLanguage = (typeof PARTY_LANGUAGES)[number];
export const isPartyLanguage = (x: unknown): x is PartyLanguage => (PARTY_LANGUAGES as readonly unknown[]).includes(x);

export interface RoomSettings {
  /** the game */
  mode: GameMode;
  /** bad lip reading: what the scene is really about */
  premise: string;
  /** genre swap: which genre */
  genre: string;
  /** the language the players speak this session (not necessarily the clip's): takes are transcribed in it, and
   *  suggested and written lines are in it */
  language: PartyLanguage;
  /** most people cast per round (everyone present, up to this); each voices one or more characters */
  maxCast: number;
  /** most lines per round: the slice is picked to hold no more, so every line in it is dubbed */
  maxLines: number;
  /** trailer: scenes in the trailer (a multiple of the players is used: everyone performs the same number) */
  scenes: number;
  /** time for one line, on top of three times its length */
  turnSeconds: number;
  /** scene: lines in script order; shuffle: any order */
  order: 'scene' | 'shuffle';
  /** length of the scene slice played in a round (the clip may be much longer) */
  sliceSeconds: number;
  /** ask the AI for a suggested line on each turn (players can always say anything) */
  suggestions: boolean;
  /** before the cast is revealed, each character is described (voice and personality) by one player, blind to who
   *  will play them; the card follows the character (the trailer game always does this) */
  cards: boolean;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  mode: 'dub',
  premise: 'two people arguing about lost cheese',
  genre: 'noir',
  language: 'en',
  maxCast: 8,
  maxLines: 12,
  scenes: 6,
  turnSeconds: 40,
  order: 'scene',
  sliceSeconds: 45,
  suggestions: true,
  cards: false,
};

export interface ClipInfo {
  id: string;
  name: string;
  poster: string | null;
  duration: number;
}

export interface Room {
  code: string;
  phase: Phase;
  round: number;
  settings: RoomSettings;
  players: Player[];
  /** the library clip being played */
  clip: ClipInfo | null;
  /** the clip's own script (what every round starts from) */
  source: { characters: PartyCharacter[]; lines: PartyLine[] };
  /** this round's script: the clip's, rewritten (badlip, telenovela, genre) or silent segments (blind) */
  characters: PartyCharacter[];
  lines: PartyLine[];
  /** the round's script is being written (the TV waits before starting) */
  preparing: boolean;
  /** what the server is doing while preparing, for the TV ("Writing 8 lines in the style of noir") */
  prepNote: string;
  /** the party project derived from the clip for this round (takes land there) */
  projectId: string | null;
  /** the part of the clip this round plays (chosen when casting) */
  slice: { start: number; end: number } | null;
  /** what each recorded take actually says (transcribed by the TV), by cue id */
  heard: Record<string, string>;
  /** suggested lines for the player (AI), by cue id */
  suggestions: Record<string, string>;
  cast: Role[];
  /** the finished round, rendered to one file every client plays together; null until rendered (or when it could not be) */
  result: { file: string; startAt: number } | null;
  /** what the room is writing and voting on (character cards, the trailer's pitch, directions and title) */
  contests: Contest[];
  /** the trailer game's own state (scenes, reviews); null in the other games */
  trailer: TrailerState | null;
  /** lines chosen for this round, in play order */
  queue: string[];
  turn: Turn | null;
  results: Result[];
  /** background audio phones play while someone records (URLs) */
  ambience: string[];
  seed: number;
}

// ------------------------------------------------------------------ actions
/** What the TV sends. The server turns `pick-clip` and `cast` into reducer actions (it loads the clip, derives the project). */
export type HostCommand =
  | { type: 'pick-clip'; clipId: string }
  | { type: 'settings'; settings: Partial<RoomSettings> }
  | { type: 'cast' }
  | { type: 'begin' }
  | { type: 'skip' }
  | { type: 'extend'; seconds: number }
  | { type: 'finish' }
  | { type: 'again' }
  | { type: 'kick'; playerId: string }
  /** the TV transcribed a take: what the player actually said */
  | { type: 'heard'; cueId: string; text: string };

/** Room changes made on the host's behalf, as the reducer sees them. */
export type HostAction =
  | { type: 'set-clip'; clip: ClipInfo; characters: PartyCharacter[]; lines: PartyLine[] }
  | { type: 'settings'; settings: Partial<RoomSettings> }
  | { type: 'cast'; projectId: string }
  | { type: 'begin' }
  | { type: 'skip' }
  | { type: 'extend'; seconds: number }
  | { type: 'finish' }
  /** the round is a project; `result` is the rendered file (the show starts a few seconds later, for everyone at once) */
  | { type: 'compiled'; result?: string }
  | { type: 'again' }
  | { type: 'kick'; playerId: string }
  | { type: 'heard'; cueId: string; text: string }
  /** the written lines for this round (new text by cue id); an empty map keeps the scene's own lines */
  | { type: 'script'; texts: Record<string, { text: string; direction?: string }> }
  /** progress while the script is written */
  | { type: 'prep-note'; note: string };

/** What a phone may ask for (the server adds who is asking). */
export type PlayerAction =
  | { type: 'status'; turn: number; status: 'recording' | 'reviewing' | 'called' }
  | { type: 'pass'; turn: number }
  /** a text for a task (a contest entry, or a review) */
  | { type: 'submit'; task: string; text: string }
  /** a vote for an entry of a task */
  | { type: 'vote'; task: string; entry: string };

/** What the server itself does (connections, uploads, the clock). */
export type SystemAction =
  | { type: 'join'; playerId: string; name: string }
  | { type: 'connection'; playerId: string; connected: boolean }
  | { type: 'uploading'; playerId: string; turn: number }
  | { type: 'submitted'; playerId: string; turn: number; file: string; start: number; duration: number }
  | { type: 'tick' }
  | { type: 'ambience'; urls: string[] }
  | { type: 'suggestion'; cueId: string; text: string }
  /** a text for a contest nobody answered (the AI) */
  | { type: 'fill'; task: string; text: string };

export type Action = HostAction | (PlayerAction & { playerId: string }) | SystemAction;

// ------------------------------------------------------------------ views
/** A line as a phone sees it: only its own lines carry the text. */
export interface LineView extends PartyLine {
  characterName: string;
  color: string;
  /** what the player who recorded this line actually said, when known */
  heard?: string;
  /** a suggested replacement line (only on the line it is your turn to record) */
  suggestion?: string;
  /** blind dubbing: the take recorded for this segment (the next player hears its last second) */
  take?: string;
  /** trailer: what the room decided this scene is about */
  direction?: string;
  /** the voice and personality of the character, from their card */
  card?: string;
}

export interface PlayerView {
  role: 'player';
  code: string;
  phase: Phase;
  mode: GameMode;
  round: number;
  me: Player | null;
  players: Pick<Player, 'id' | 'name' | 'connected'>[];
  clip: ClipInfo | null;
  projectId: string | null;
  /** I am playing in this round (my characters stay hidden until the cast is revealed) */
  inRound: boolean;
  /** the characters I play this round (once the cast is revealed) */
  mine: PartyCharacter[];
  /** everyone's parts this round (names only) */
  cast: { player: string; character: string; color: string }[];
  /** whose turn it is, without the script */
  turn: { n: number; player: string; character: string; color: string; status: TurnStatus; deadline: number; mine: boolean } | null;
  /** my line when it is my turn, with the lines around it for context */
  line: LineView | null;
  context: { before: LineView | null; after: LineView | null };
  progress: { done: number; total: number };
  ambience: string[];
  /** what this phone is asked to write or vote on right now (character cards, the trailer's pitch, directions, reviews…) */
  tasks: TaskView[];
  /** this phone holds the room's host key: it may send host commands */
  isHost: boolean;
  /** what the room is doing, for a phone with no TV to look at */
  board: Board;
  /** the address that brings a friend into this room */
  joinUrl: string;
}

/** A read-only display of a room (a TV, a projector): the public board and nothing else. */
export interface ScreenView {
  role: 'screen';
  board: Board;
  joinUrl: string;
}

export interface HostView {
  role: 'host';
  room: Room;
  /** the URL phones open (the QR code) */
  joinUrl: string;
}

export type View = PlayerView | HostView | ScreenView;

// ------------------------------------------------------------------ wire messages
export type ClientMessage =
  | { type: 'hello-host'; code: string; hostKey: string }
  /** a phone; with the room's host key it is also the host. `worker`: this client can render the round's mix (it has the audio engine) */
  | { type: 'hello-player'; code: string; token?: string; name?: string; hostKey?: string; worker?: boolean }
  /** a display that only shows the room */
  | { type: 'hello-screen'; code: string }
  | { type: 'host'; command: HostCommand }
  | { type: 'player'; action: PlayerAction }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; token: string }
  | { type: 'view'; view: View /** server clock (epoch ms), so phones can show deadlines on their own clock */; now: number }
  | { type: 'error'; message: string; code?: 'no-room' | 'bad-token' | 'room-full' | 'not-allowed' | 'bad-message' }
  /** work for a capable client: render the finished round's mix with the shared graph and upload it */
  | { type: 'job'; job: 'render'; projectId: string }
  | { type: 'pong' };

/** A colour per player, by join order (players are content: their colour marks their turns, tracks and takes). */
export const PLAYER_COLORS = ['#ff6b6b', '#4dd4ac', '#ffd166', '#6aa6ff', '#c792ea', '#ff9f68', '#9bb86f', '#c78fa5'];
export const playerColor = (room: Pick<Room, 'players'>, playerId: string): string => {
  const i = room.players.findIndex((p) => p.id === playerId);
  return PLAYER_COLORS[(i < 0 ? 0 : i) % PLAYER_COLORS.length];
};

/** Room codes avoid letters that read alike (0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;
export const MAX_PLAYERS = 16;
export const isRoomCode = (s: unknown): s is string => typeof s === 'string' && new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(s);
