// Party rooms on the server: the only real copy of every Room, the WebSockets of the TV and the phones,
// and the side effects the pure reducer cannot do (load a clip, derive the round's project, store takes, compile).
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ComposeInput, SuggestInput, TrailerJob } from '@doblaje/ai';
import { AppError, clamp, errorMessage, type MediaPart, newId, type Project, type ProjectRepository, type TimeRange } from '@doblaje/core';
import { isSoundId, type SoundRepository } from '@doblaje/db';
import {
  type Action,
  boardOf,
  type ClientMessage,
  CODE_ALPHABET,
  CODE_LENGTH,
  compileRound,
  compileTrailer,
  createRoom,
  type HostCommand,
  isRoomCode,
  needsTick,
  planTrailer,
  playerView,
  type Rng,
  type Room,
  RoomError,
  reduce,
  type ServerMessage,
  scriptOf,
  seededRng,
  type TrailerCopy,
  unfilled,
  type View,
} from '@doblaje/party';
import { type WebSocket, WebSocketServer } from 'ws';
import { streamToFile } from '../http.ts';

/**
 * One connected client. What it may do depends on its capabilities, not on what kind of device it is:
 * a TV is a host (commands, the whole room), a phone is a player, a phone holding the host key is both,
 * and a screen only watches the public board.
 */
interface Conn {
  ws: WebSocket;
  code: string | null;
  role: 'host' | 'player' | 'screen' | null;
  playerId: string | null;
  /** may send host commands (a TV, or a player that showed the host key) */
  host: boolean;
  alive: boolean;
  /** the address it connected from, for limits */
  ip: string;
  /** can render the round's mix (it has the audio engine) */
  worker: boolean;
}

interface Entry {
  room: Room;
  hostKey: string;
  /** player token → player id (a phone keeps its token to come back after a reload or a dropped Wi-Fi) */
  tokens: Map<string, string>;
  rng: Rng;
  conns: Set<Conn>;
  lastActive: number;
  compiling: boolean;
  /** suggestions already asked for (round, line, what the previous player said) */
  asked: Set<string>;
  /** contests already handed to the AI (round, contest) */
  filled: Set<string>;
  /** who opened the room (null: nobody signed in) and the library it plays from: theirs */
  ownerId: string | null;
  lib: Library;
  /** players that showed the host key (their token may then use the host's HTTP routes) */
  hosts: Set<string>;
  /** the round projects made for this room (deleted with it when the room empties, if the server is set to) */
  projectIds: Set<string>;
  emptyTimer: NodeJS.Timeout | null;
  /** a render the room is waiting for: resolved with the rendered file (or null) when the host's mix arrives */
  rendering: ((file: string | null) => void) | null;
}

/** A host's library: their clips and rounds, and their background sounds. A server of accounts keeps one per person. */
export interface Library {
  projects: ProjectRepository;
  sounds: SoundRepository;
}

export interface HubDeps {
  /** the library a room plays from: its owner's (null: nobody signed in, the shared library of a laptop) */
  library: (ownerId: string | null) => Library;
  /** the address phones open for a room (the QR code) */
  joinUrl(code: string): string;
  /** the content of a file of a library clip (the library may keep it encrypted) */
  clipFile?: (lib: Library, clipId: string, name: string) => Buffer;
  /** minutes after the last person leaves before the room and every file made for it are deleted (undefined: kept) */
  emptyRoomMinutes?: number;
  /** rooms open at once (default 20) */
  maxRooms?: number;
  /** the address a request really comes from (behind a proxy: its forwarded header) */
  clientIp?: (req: IncomingMessage) => string;
  now?: () => number;
  /** seed for a new room (tests pass a fixed one) */
  seed?: () => number;
  /** a suggested line for a turn (the AI); null when there is none. Must not throw. */
  suggest?: (input: SuggestInput) => Promise<string | null>;
  /** the written lines of a written game (badlip, telenovela, genre), by cue id; {} keeps the scene's lines */
  write?: (job: ScriptJob) => Promise<Record<string, { text: string; direction?: string }>>;
  /** make a round's media out of these parts of the clip (and save it): the slice, or a trailer's scenes and gaps; without it the result keeps the whole clip */
  cut?: (lib: Library, projectId: string, parts: MediaPart[]) => Promise<void>;
  /** a text for a trailer contest nobody answered (a pitch, a direction, a title); null when there is none. Must not throw. */
  compose?: (input: ComposeInput) => Promise<string | null>;
  /** the transcript of a take (the server listens to what players said); null when it cannot. Must not throw. */
  transcribe?: (file: string, language: string) => Promise<string | null>;
  /** make the finished round's result file from the mix a host client rendered (`renders/mix.wav`); the file's name in the project, or null */
  render?: (lib: Library, projectId: string, opts: { subtitles: boolean }) => Promise<string | null>;
  /** the words around a trailer (opening card, narrator lines, critics' newspapers, tagline). Must not throw. */
  trailer?: (job: TrailerJob) => Promise<TrailerCopy>;
}

/** What to write for a round. */
export interface ScriptJob {
  mode: 'badlip' | 'telenovela' | 'genre';
  premise: string;
  genre: string;
  /** the language the players speak: the lines are written in it */
  language: string;
  lines: { id: string; text: string; character: string; start: number; end: number }[];
}

/** How long the room waits for a host client to render the mix before the show goes ahead without a result file. */
const RENDER_WAIT_MS = 90_000;
const MAX_MIX_BYTES = 600 * 1024 ** 2;
const MAX_ROOMS = 20;
const IDLE_ROOM_MS = 6 * 3600_000;
const MAX_TAKE_BYTES = 100 * 1024 ** 2;
/** files of the round's project a cast phone may fetch */
const PHONE_MEDIA = /^(proxy\.mp4|result\.mp4|poster\.jpg|audio_orig\.wav|stem_dialogue\.wav|stem_bg\.wav|takes\/take_[\w-]+\.wav)$/;

const randomToken = () => crypto.randomBytes(18).toString('base64url');

export class PartyHub {
  readonly #deps: HubDeps;
  readonly #rooms = new Map<string, Entry>();
  readonly #wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  readonly #timer: NodeJS.Timeout;
  #beat = 0;

  constructor(deps: HubDeps) {
    this.#deps = deps;
    this.#timer = setInterval(() => this.#tick(), 1000);
    this.#timer.unref();
  }

  get #now(): number {
    return this.#deps.now?.() ?? Date.now();
  }

  /** A new room for the TV. The host key proves later that a socket is that TV. */
  create({ ownerId = null }: { ownerId?: string | null } = {}): { code: string; hostKey: string; joinUrl: string } {
    this.#collect();
    if (this.#rooms.size >= (this.#deps.maxRooms ?? MAX_ROOMS)) throw new AppError(503, 'too many party rooms are open');
    let code = '';
    do code = Array.from(crypto.randomBytes(CODE_LENGTH), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    while (this.#rooms.has(code));
    const seed = this.#deps.seed?.() ?? crypto.randomBytes(4).readUInt32LE();
    const entry: Entry = {
      room: createRoom(code, seed),
      hostKey: randomToken(),
      tokens: new Map(),
      rng: seededRng(seed),
      conns: new Set(),
      lastActive: this.#now,
      compiling: false,
      asked: new Set(),
      filled: new Set(),
      ownerId,
      lib: this.#deps.library(ownerId),
      hosts: new Set(),
      projectIds: new Set(),
      emptyTimer: null,
      rendering: null,
    };
    this.#rooms.set(code, entry);
    this.#watchEmpty(entry); // nobody may ever come
    this.#apply(entry, { type: 'ambience', urls: entry.lib.sounds.list().map((s) => s.url) });
    return { code, hostKey: entry.hostKey, joinUrl: this.#deps.joinUrl(code) };
  }

  /**
   * A party server keeps nothing for an empty room: once the last client has gone (and a few minutes passed, for a phone
   * that dropped off the network), the room and the media made for it (takes, rendered rounds) are deleted for good.
   * The library's clips are never touched. Anyone still watching may download the result before that.
   */
  #watchEmpty(entry: Entry) {
    const minutes = this.#deps.emptyRoomMinutes;
    if (minutes === undefined) return;
    if (entry.conns.size) {
      if (entry.emptyTimer) clearTimeout(entry.emptyTimer);
      entry.emptyTimer = null;
    } else if (!entry.emptyTimer) {
      entry.emptyTimer = setTimeout(() => this.#discard(entry), minutes * 60_000);
      entry.emptyTimer.unref();
    }
  }

  #discard(entry: Entry) {
    entry.emptyTimer = null;
    if (entry.conns.size) return;
    entry.rendering?.(null);
    for (const id of entry.projectIds) {
      try {
        entry.lib.projects.remove(id);
      } catch (e) {
        console.error('[party] could not delete a room’s media', errorMessage(e));
      }
    }
    entry.projectIds.clear();
    this.#rooms.delete(entry.room.code);
  }

  /** Rooms open now. */
  get size(): number {
    return this.#rooms.size;
  }

  /** The room a request names, for tests and routes. */
  room(code: string): Room {
    return this.#entry(code).room;
  }

  // ---------------------------------------------------------------- sockets
  /** Hand an HTTP upgrade on /party/ws to the hub. Browsers must come from the same origin as the page. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    this.#wss.handleUpgrade(req, socket, head, (ws) => this.#attach(ws, this.#deps.clientIp?.(req) ?? req.socket.remoteAddress ?? ''));
  }

  #attach(ws: WebSocket, ip = '') {
    const conn: Conn = { ws, code: null, role: null, playerId: null, host: false, alive: true, ip, worker: false };
    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return this.#send(conn, { type: 'error', message: 'text frames only', code: 'bad-message' });
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data)) as ClientMessage;
      } catch {
        return this.#send(conn, { type: 'error', message: 'invalid JSON', code: 'bad-message' });
      }
      this.#onMessage(conn, msg).catch((e: unknown) => this.#send(conn, { type: 'error', message: errorMessage(e) }));
    });
    ws.on('close', () => {
      const entry = conn.code ? this.#rooms.get(conn.code) : undefined;
      if (!entry) return;
      entry.conns.delete(conn);
      this.#watchEmpty(entry);
      const id = conn.playerId;
      // still connected on another socket (a second tab, a reconnect that won the race)? then nothing changed
      if (id && ![...entry.conns].some((c) => c.playerId === id)) this.#dispatch(entry, { type: 'connection', playerId: id, connected: false });
    });
  }

  async #onMessage(conn: Conn, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'ping':
        return this.#send(conn, { type: 'pong' });
      case 'hello-host': {
        const entry = this.#rooms.get(String(msg.code));
        if (!entry) return this.#send(conn, { type: 'error', message: 'This room is closed', code: 'no-room' });
        if (!safeEqual(msg.hostKey, entry.hostKey)) return this.#send(conn, { type: 'error', message: 'Not this room’s TV', code: 'not-allowed' });
        Object.assign(conn, { code: entry.room.code, role: 'host', playerId: null, host: true });
        entry.conns.add(conn);
        this.#watchEmpty(entry);
        return this.#send(conn, this.#viewMessage(entry, conn));
      }
      case 'hello-screen': {
        const entry = this.#rooms.get(String(msg.code).toUpperCase());
        if (!entry) return this.#send(conn, { type: 'error', message: 'There is no room with that code', code: 'no-room' });
        Object.assign(conn, { code: entry.room.code, role: 'screen', playerId: null, host: false });
        entry.conns.add(conn);
        this.#watchEmpty(entry);
        return this.#send(conn, this.#viewMessage(entry, conn));
      }
      case 'hello-player': {
        const entry = this.#rooms.get(String(msg.code).toUpperCase());
        if (!entry) return this.#send(conn, { type: 'error', message: 'There is no room with that code', code: 'no-room' });
        let token = typeof msg.token === 'string' ? msg.token : '';
        let id = entry.tokens.get(token);
        if (!id) {
          if (!msg.name) return this.#send(conn, { type: 'error', message: 'Type your name', code: 'bad-token' });
          id = newId('u');
          token = randomToken();
          this.#apply(entry, { type: 'join', playerId: id, name: msg.name }); // throws (name, room full) before anything is kept
          entry.tokens.set(token, id);
        } else if (msg.name) {
          this.#apply(entry, { type: 'join', playerId: id, name: msg.name });
        }
        // the host key turns a phone into the host as well as a player (the room's creator)
        const host = typeof msg.hostKey === 'string' && safeEqual(msg.hostKey, entry.hostKey);
        Object.assign(conn, { code: entry.room.code, role: 'player', playerId: id, host, worker: msg.worker === true });
        if (host) entry.hosts.add(id);
        entry.conns.add(conn);
        this.#watchEmpty(entry);
        this.#send(conn, { type: 'welcome', playerId: id, token });
        return this.#dispatch(entry, { type: 'connection', playerId: id, connected: true });
      }
      case 'host': {
        const entry = this.#connEntry(conn);
        if (!conn.host) throw new RoomError('Only the host can do that');
        return this.#command(entry, msg.command);
      }
      case 'player': {
        const entry = this.#connEntry(conn);
        if (conn.role !== 'player' || !conn.playerId) throw new RoomError('Join the room first');
        const a = msg.action;
        if (a.type === 'status' && ['recording', 'reviewing', 'called'].includes(a.status))
          return this.#dispatch(entry, { type: 'status', turn: Number(a.turn), status: a.status, playerId: conn.playerId });
        if (a.type === 'pass') return this.#dispatch(entry, { type: 'pass', turn: Number(a.turn), playerId: conn.playerId });
        if (a.type === 'submit') return this.#dispatch(entry, { type: 'submit', task: String(a.task), text: String(a.text ?? ''), playerId: conn.playerId });
        if (a.type === 'vote') return this.#dispatch(entry, { type: 'vote', task: String(a.task), entry: String(a.entry), playerId: conn.playerId });
        throw new RoomError('Unknown action');
      }
      default:
        return this.#send(conn, { type: 'error', message: 'unknown message', code: 'bad-message' });
    }
  }

  async #command(entry: Entry, cmd: HostCommand): Promise<void> {
    const { projects } = entry.lib;
    switch (cmd.type) {
      case 'pick-clip': {
        const clip = projects.get(String(cmd.clipId));
        if (!clip.template) throw new RoomError('Pick a clip from the library');
        if (!clip.media?.ready) throw new RoomError('This clip is still being prepared');
        const s = scriptOf(clip);
        if (!s.lines.length) throw new RoomError('This clip has no lines with characters yet. Prepare it first: subtitles and voices.');
        this.#refreshAmbience(entry);
        return this.#dispatch(entry, { type: 'set-clip', clip: s.info, characters: s.characters, lines: s.lines });
      }
      case 'cast': {
        const clip = entry.room.clip;
        if (!clip) throw new RoomError('Pick a clip first');
        const project = projects.derive(clip.id, { mode: 'party', name: `${clip.name} · ${entry.room.code} ${entry.room.round + 1}` });
        entry.projectIds.add(project.id);
        try {
          this.#refreshAmbience(entry);
          this.#dispatch(entry, { type: 'cast', projectId: project.id });
        } catch (e) {
          projects.remove(project.id); // nobody to cast: do not leave an empty project behind
          entry.projectIds.delete(project.id);
          throw e;
        }
        if (entry.room.preparing) void this.#writeScript(entry);
        return;
      }
      case 'settings':
        return this.#dispatch(entry, { type: 'settings', settings: cmd.settings ?? {} });
      case 'extend':
        return this.#dispatch(entry, { type: 'extend', seconds: Number(cmd.seconds) });
      case 'kick': {
        const id = String(cmd.playerId);
        for (const [tok, pid] of entry.tokens) if (pid === id) entry.tokens.delete(tok);
        for (const c of entry.conns) {
          if (c.playerId !== id) continue;
          this.#send(c, { type: 'error', message: 'You left the room', code: 'bad-token' });
          c.ws.close();
          entry.conns.delete(c);
        }
        return this.#dispatch(entry, { type: 'kick', playerId: id });
      }
      case 'heard':
        return this.#dispatch(entry, { type: 'heard', cueId: String(cmd.cueId), text: String(cmd.text ?? '') });
      case 'begin':
      case 'skip':
      case 'finish':
      case 'again':
        return this.#dispatch(entry, { type: cmd.type });
      default:
        throw new RoomError('Unknown command');
    }
  }

  // ---------------------------------------------------------------- state
  /** Reduce without broadcasting (the caller broadcasts, or throws before anything changed). */
  #apply(entry: Entry, action: Action) {
    entry.room = reduce(entry.room, action, { now: this.#now, rng: entry.rng });
    entry.lastActive = this.#now;
  }

  #dispatch(entry: Entry, action: Action) {
    this.#apply(entry, action);
    this.#broadcast(entry);
    if (entry.room.phase === 'compiling' && !entry.compiling) void this.#compile(entry);
    this.#suggest(entry);
    this.#compose(entry);
  }

  /** Contests nobody answered (a card, a direction, a title…): ask the AI for a text (the room's clock falls back later). */
  #compose(entry: Entry) {
    const { room } = entry;
    const ask = this.#deps.compose;
    if (!ask) return;
    const tr = room.trailer;
    for (const c of unfilled(room.contests)) {
      const key = `${room.round}|${c.id}`;
      if (entry.filled.has(key)) continue;
      entry.filled.add(key);
      // what the AI should keep to: the character a card or a direction is about
      const sceneCharacter = c.scene !== null ? tr?.scenes[c.scene]?.character : undefined;
      const who = room.characters.find((x) => x.id === (c.kind === 'card' ? c.subject : sceneCharacter));
      const before = c.scene !== null ? (tr?.scenes[c.scene - 1]?.direction ?? null) : null;
      void ask({
        kind: c.kind,
        language: room.settings.language,
        scene: room.clip?.name ?? '',
        logline: tr?.logline ?? null,
        before,
        ...(who ? { character: { name: who.name, ...(who.card ? { card: who.card } : {}) } } : {}),
      }).then((text) => {
        if (!text || this.#rooms.get(room.code) !== entry || entry.room.round !== room.round) return;
        try {
          this.#dispatch(entry, { type: 'fill', task: c.id, text });
        } catch {}
      });
    }
  }

  /**
   * Ask for a suggested line for the current turn: once when the turn starts, and once more when the TV reports
   * what the previous player actually said (the suggestion then riffs on it). Arrives whenever it arrives.
   */
  #suggest(entry: Entry) {
    const { room } = entry;
    const ask = this.#deps.suggest;
    if (!ask || !room.settings.suggestions || room.settings.mode !== 'dub' || room.phase !== 'playing' || !room.turn) return;
    const script = [...room.lines].sort((a, b) => a.start - b.start);
    const at = script.findIndex((l) => l.cueId === room.turn?.cueId);
    const line = script[at];
    if (!line) return;
    const prev = at > 0 ? script[at - 1] : undefined;
    const said = prev ? room.heard[prev.cueId] : undefined;
    const key = `${room.round}|${line.cueId}|${said ?? ''}`;
    if (entry.asked.has(key)) return;
    entry.asked.add(key);
    const nameOf = (id: string) => room.characters.find((c) => c.id === id)?.name ?? '?';
    const card = room.characters.find((c) => c.id === line.character)?.card;
    void ask({
      scene: room.clip?.name ?? '',
      character: nameOf(line.character),
      original: line.text,
      seconds: line.end - line.start,
      previous: prev ? { character: nameOf(prev.character), original: prev.text, ...(said ? { said } : {}) } : null,
      language: room.settings.language,
      ...(card ? { card } : {}),
    }).then((text) => {
      if (!text || this.#rooms.get(room.code) !== entry) return;
      try {
        this.#apply(entry, { type: 'suggestion', cueId: line.cueId, text });
        this.#broadcast(entry);
      } catch {}
    });
  }

  /**
   * The round becomes its result: the media is cut down to the slice the players dubbed (unless that is the whole
   * clip), then the takes are laid in. A failed cut still gives a show, on the whole clip.
   */
  async #compile(entry: Entry) {
    entry.compiling = true;
    const { room } = entry;
    let result: string | undefined;
    try {
      if (room.projectId && room.trailer) {
        await this.#compileTrailer(entry);
      } else if (room.projectId) {
        const id = room.projectId;
        const duration = entry.lib.projects.get(id).media?.duration ?? 0;
        const slice = room.slice;
        let cut: TimeRange | null = null;
        if (slice && this.#deps.cut && (slice.start > 0.05 || slice.end < duration - 0.05)) {
          try {
            await this.#deps.cut(entry.lib, id, [slice]);
            cut = slice;
          } catch (e) {
            console.error('[party] cutting the slice failed, keeping the whole clip', errorMessage(e));
          }
        }
        entry.lib.projects.save(compileRound(entry.lib.projects.get(id), room, cut));
      }
      // the round as one file every client plays together (a host client renders the mix; nobody to render: no file)
      result = (await this.#render(entry)) ?? undefined;
    } catch (e) {
      console.error('[party] compile failed', errorMessage(e));
    } finally {
      entry.compiling = false;
    }
    if (entry.room.phase === 'compiling') this.#dispatch(entry, { type: 'compiled', ...(result ? { result } : {}) });
  }

  /**
   * Ask a host client that can (it has the audio engine) to render the finished round's mix with the shared graph and
   * upload it; the server then makes the result file from it. Null when nobody can, or nobody answers in time.
   */
  #render(entry: Entry): Promise<string | null> {
    const id = entry.room.projectId;
    const worker = [...entry.conns].find((c) => c.worker && c.host);
    if (!this.#deps.render || !id || !worker) return Promise.resolve(null);
    return new Promise((resolve) => {
      const done = (file: string | null) => {
        clearTimeout(timer);
        entry.rendering = null;
        resolve(file);
      };
      const timer = setTimeout(() => done(null), RENDER_WAIT_MS);
      entry.rendering = done;
      this.#send(worker, { type: 'job', job: 'render', projectId: id });
    });
  }

  /**
   * A trailer: the words around the players' (the AI, or stock lines), then the media is assembled from the scenes and
   * the gaps the cards sit on, then the takes are laid on that timeline.
   */
  async #compileTrailer(entry: Entry) {
    const { room } = entry;
    const tr = room.trailer;
    const id = room.projectId;
    if (!tr || !id) return;
    const lines = tr.scenes.map((s) => ({ direction: s.direction ?? '', said: room.heard[s.cueId] ?? '' }));
    const copy = await this.#deps.trailer?.({
      language: room.settings.language,
      scene: room.clip?.name ?? '',
      logline: tr.logline ?? room.clip?.name ?? '',
      title: tr.title ?? '',
      directions: lines.map((l) => l.direction),
      said: lines.map((l) => l.said),
      critics: tr.reviews.length,
    });
    const plan = planTrailer(room, copy);
    await this.#deps.cut?.(entry.lib, id, plan.parts);
    entry.lib.projects.save(compileTrailer(entry.lib.projects.get(id), room, plan.result));
  }

  /** The server listens to a take (when it can) and tells the room what the player said. Arrives whenever it arrives. */
  #listen(entry: Entry, cueId: string, file: string) {
    const transcribe = this.#deps.transcribe;
    const { room } = entry;
    if (!transcribe) return;
    void transcribe(file, room.settings.language).then((text) => {
      if (!text?.trim() || this.#rooms.get(room.code) !== entry || entry.room.round !== room.round) return;
      try {
        this.#dispatch(entry, { type: 'heard', cueId, text });
      } catch {}
    });
  }

  /** Written games: write the round's lines (AI, or the offline generator), then let the TV start. */
  async #writeScript(entry: Entry) {
    const { room } = entry;
    const s = room.settings;
    const round = room.round;
    let texts: Record<string, { text: string; direction?: string }> = {};
    try {
      if (this.#deps.write && (s.mode === 'badlip' || s.mode === 'telenovela' || s.mode === 'genre')) {
        const nameOf = (id: string) => room.characters.find((c) => c.id === id)?.name ?? '';
        // the writer works line by line (each subtitle of each turn), in scene order
        const lines = room.queue
          .map((id) => room.lines.find((l) => l.cueId === id))
          .filter((l) => l !== undefined)
          .flatMap((l) => (l.parts ?? [l]).map((x) => ({ id: x.cueId, text: x.text, character: nameOf(l.character), start: x.start, end: x.end })))
          .sort((a, b) => a.start - b.start);
        this.#dispatch(entry, { type: 'prep-note', note: `${lines.length}` }); // the TV words it: "Writing 8 lines…"
        texts = await this.#deps.write({ mode: s.mode, premise: s.premise, genre: s.genre, language: s.language, lines });
      }
    } catch (e) {
      console.error('[party] could not write the script', errorMessage(e)); // the round plays the scene's own lines
    }
    if (this.#rooms.get(room.code) !== entry || entry.room.round !== round || (entry.room.phase !== 'casting' && entry.room.phase !== 'cards')) return;
    this.#dispatch(entry, { type: 'script', texts });
  }

  #refreshAmbience(entry: Entry) {
    this.#apply(entry, { type: 'ambience', urls: entry.lib.sounds.list().map((s) => s.url) });
  }

  #viewMessage(entry: Entry, conn: Conn): ServerMessage {
    const joinUrl = this.#deps.joinUrl(entry.room.code);
    const view: View =
      conn.role === 'host'
        ? { role: 'host', room: entry.room, joinUrl }
        : conn.role === 'screen'
          ? { role: 'screen', board: boardOf(entry.room), joinUrl }
          : playerView(entry.room, conn.playerId ?? '', { isHost: conn.host, joinUrl });
    return { type: 'view', view, now: this.#now };
  }

  #broadcast(entry: Entry) {
    for (const c of entry.conns) this.#send(c, this.#viewMessage(entry, c));
  }

  #send(conn: Conn, msg: ServerMessage) {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  #entry(code: string): Entry {
    const entry = isRoomCode(code) ? this.#rooms.get(code) : undefined;
    if (!entry) throw new AppError(404, 'no such room');
    return entry;
  }
  #connEntry(conn: Conn): Entry {
    const entry = conn.code ? this.#rooms.get(conn.code) : undefined;
    if (!entry) throw new RoomError('Join a room first');
    return entry;
  }

  /** Every second: lines whose time ran out; every 15 s: drop sockets that stopped answering. */
  #tick() {
    const now = this.#now;
    for (const entry of this.#rooms.values()) {
      if (needsTick(entry.room, now)) this.#dispatch(entry, { type: 'tick' });
    }
    if (++this.#beat % 15) return;
    for (const entry of this.#rooms.values()) {
      for (const c of entry.conns) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        c.ws.ping();
      }
    }
    this.#collect();
  }

  /** Forget rooms nobody has touched for hours. */
  #collect() {
    for (const [code, e] of this.#rooms) if (!e.conns.size && this.#now - e.lastActive > IDLE_ROOM_MS) this.#rooms.delete(code);
  }

  // ---------------------------------------------------------------- HTTP side
  /** Which player a token belongs to (phones send it as `x-party-token`, or `?t=` where headers cannot go). */
  player(code: string, token: string | null | undefined): { entry: Room; playerId: string } {
    const entry = this.#entry(code);
    const playerId = token ? entry.tokens.get(token) : undefined;
    if (!playerId) throw new AppError(403, 'not a player in this room');
    return { entry: entry.room, playerId };
  }

  /** A background sound of the library of the room this token belongs to (null: not a player, or no such sound). */
  soundFile(token: string | null, soundId: string): string | null {
    const entry = token ? [...this.#rooms.values()].find((e) => e.tokens.has(token)) : undefined;
    if (!entry || !isSoundId(soundId)) return null;
    const file = entry.lib.sounds.file(soundId);
    return fs.existsSync(file) ? file : null;
  }

  /** The round's project, for a cast phone's audio engine. */
  project(code: string, token: string | null): Project {
    const { entry: room, playerId } = this.player(code, token);
    const entry = this.#entry(code);
    // the cast, and the host (who renders the mix of the finished round)
    if (!room.projectId || !(room.cast.some((c) => c.playerId === playerId) || entry.hosts.has(playerId))) throw new AppError(409, 'you are not in this round');
    return entry.lib.projects.get(room.projectId);
  }

  /** Whether a request comes from the host: the room's host key, or the token of a phone that showed it. */
  isHost(code: string, token: string | null | undefined, hostKey?: string | null): boolean {
    const entry = this.#entry(code);
    if (hostKey && safeEqual(hostKey, entry.hostKey)) return true;
    const playerId = token ? entry.tokens.get(token) : undefined;
    return !!playerId && entry.hosts.has(playerId);
  }

  /** The library clips a host may pick from (ready, with characters that speak). */
  clips(
    code: string,
    token: string | null | undefined,
    hostKey?: string | null,
  ): { id: string; name: string; duration: number; characters: string[]; lines: number }[] {
    if (!this.isHost(code, token, hostKey)) throw new AppError(403, 'only the host can pick the clip');
    const { projects } = this.#entry(code).lib;
    return projects
      .list({ template: true })
      .filter((c) => c.ready)
      .map((c) => ({ c, script: scriptOf(projects.get(c.id)) }))
      .filter((x) => x.script.lines.length > 0)
      .map(({ c, script }) => ({
        id: c.id,
        name: c.name,
        duration: c.duration,
        characters: script.characters.filter((x) => x.lines > 0).map((x) => x.name),
        lines: script.lines.length,
      }));
  }

  /** A library clip's poster, for a phone that belongs to the room. */
  poster(code: string, token: string | null | undefined, clipId: string): Buffer {
    this.player(code, token);
    const { lib } = this.#entry(code);
    const clip = lib.projects.get(clipId);
    if (!clip.template || !clip.media?.ready) throw new AppError(404, 'not found');
    return (this.#deps.clipFile ?? ((l, id, name) => fs.readFileSync(l.projects.file(id, name))))(lib, clipId, 'poster.jpg');
  }

  /**
   * The mix a host client rendered for the finished round (a 16-bit WAV): stored in the round's project, then made into
   * the result file every client plays. Only while the room is waiting for it.
   */
  async receiveMix(code: string, token: string | null | undefined, hostKey: string | null | undefined, req: IncomingMessage): Promise<{ file: string }> {
    if (!this.isHost(code, token, hostKey)) throw new AppError(403, 'only the host can send the mix');
    const entry = this.#entry(code);
    const id = entry.room.projectId;
    if (!entry.rendering || !id || !this.#deps.render) throw new AppError(409, 'no mix is wanted now');
    const dest = entry.lib.projects.file(id, 'renders/mix.wav');
    fs.mkdirSync(entry.lib.projects.file(id, 'renders'), { recursive: true });
    try {
      await streamToFile(req, dest, MAX_MIX_BYTES);
      const file = await this.#deps.render(entry.lib, id, { subtitles: entry.room.settings.mode !== 'blind' });
      entry.rendering?.(file);
      if (!file) throw new AppError(500, 'could not make the result');
      return { file };
    } catch (e) {
      entry.rendering?.(null);
      throw e;
    }
  }

  /** A media file of the round's project, for a phone in the room. */
  mediaFile(code: string, token: string | null, name: string): string {
    const { entry: room } = this.player(code, token);
    if (!room.projectId || !PHONE_MEDIA.test(name)) throw new AppError(404, 'not found');
    return this.#entry(code).lib.projects.file(room.projectId, name);
  }

  /**
   * A recorded line from the phone whose turn it is: a 16-bit WAV, already placed in time by the phone
   * (`start`, latency-compensated). Stored in the round's project; the next line is called.
   */
  async submitTake(code: string, token: string | null, turnN: number, start: number, req: IncomingMessage): Promise<{ file: string; duration: number }> {
    const { playerId } = this.player(code, token);
    const entry = this.#entry(code);
    try {
      this.#dispatch(entry, { type: 'uploading', playerId, turn: turnN });
    } catch (e) {
      throw new AppError(409, errorMessage(e));
    }
    const { room } = entry;
    const line = room.lines.find((l) => l.cueId === room.turn?.cueId);
    if (!room.projectId || !line) throw new AppError(409, 'no line to record');
    const file = `take_${newId('k')}.wav`;
    const dest = entry.lib.projects.file(room.projectId, `takes/${file}`);
    fs.mkdirSync(entry.lib.projects.file(room.projectId, 'takes'), { recursive: true });
    await streamToFile(req, dest, MAX_TAKE_BYTES);
    const duration = wavDuration(dest);
    if (!(duration > 0.05)) {
      fs.rmSync(dest, { force: true });
      throw new AppError(400, 'the recording is empty');
    }
    const at = clamp(Number.isFinite(start) ? start : line.start, Math.max(0, line.start - 10), line.end + 10);
    try {
      this.#dispatch(entry, { type: 'submitted', playerId, turn: turnN, file, start: at, duration });
    } catch (e) {
      fs.rmSync(dest, { force: true });
      throw new AppError(409, errorMessage(e));
    }
    this.#listen(entry, line.cueId, dest);
    return { file, duration };
  }

  close(): void {
    clearInterval(this.#timer);
    for (const e of this.#rooms.values()) {
      if (e.emptyTimer) clearTimeout(e.emptyTimer);
      for (const c of e.conns) c.ws.terminate();
    }
    this.#rooms.clear();
    this.#wss.close();
  }
}

function safeEqual(a: unknown, b: string): boolean {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Duration of a PCM WAV file from its header (0 when it is not one). */
export function wavDuration(file: string): number {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(4096);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    if (n < 44 || head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') return 0;
    let byteRate = 0;
    for (let p = 12; p + 8 <= n; ) {
      const id = head.toString('ascii', p, p + 4);
      const size = head.readUInt32LE(p + 4);
      if (id === 'fmt ') byteRate = head.readUInt32LE(p + 16);
      if (id === 'data') {
        const bytes = Math.min(size, fs.fstatSync(fd).size - (p + 8));
        return byteRate ? bytes / byteRate : 0;
      }
      p += 8 + size + (size % 2);
    }
    return 0;
  } finally {
    fs.closeSync(fd);
  }
}
