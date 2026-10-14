// Browser side of a room's WebSocket, shared by the TV and the phone app (and usable from Node tests).
// Reconnects by itself (phones sleep, Wi-Fi drops) and re-sends its hello, so the server puts it back in the room.
// Implements the Svelte store contract (`subscribe`), so a component can read `$client`.
import type { ClientMessage, HostCommand, PlayerAction, ServerMessage, View } from './protocol.ts';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface ClientState<V extends View> {
  status: ConnectionStatus;
  view: V | null;
  /** the last refusal from the server (cleared by the next view) */
  error: { message: string; code?: string } | null;
  /** server clock minus this clock, ms: deadline - (Date.now() + skew) is the time left */
  skew: number;
}

export interface ClientOptions {
  /** ws:// or wss:// URL of /party/ws */
  url: string;
  /** what to say after every (re)connect */
  hello: () => ClientMessage;
  onWelcome?: (playerId: string, token: string) => void;
  /** the server asks this client for work (render the finished round's mix) */
  onJob?: (job: Extract<ServerMessage, { type: 'job' }>) => void;
  /** a fatal refusal (room closed, kicked): the client stops reconnecting */
  onFatal?: (e: { message: string; code?: string }) => void;
}

const FATAL = new Set(['no-room', 'bad-token', 'not-allowed']);

export class PartyClient<V extends View = View> {
  #opts: ClientOptions;
  #ws: WebSocket | null = null;
  #retry = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #ping: ReturnType<typeof setInterval> | null = null;
  #stopped = false;
  #subs = new Set<(s: ClientState<V>) => void>();
  state: ClientState<V> = { status: 'connecting', view: null, error: null, skew: 0 };

  constructor(opts: ClientOptions) {
    this.#opts = opts;
    this.#connect();
  }

  subscribe(run: (s: ClientState<V>) => void): () => void {
    this.#subs.add(run);
    run(this.state);
    return () => this.#subs.delete(run);
  }

  #set(patch: Partial<ClientState<V>>) {
    this.state = { ...this.state, ...patch };
    for (const s of this.#subs) s(this.state);
  }

  #connect() {
    if (this.#stopped) return;
    this.#set({ status: 'connecting' });
    const ws = new WebSocket(this.#opts.url);
    this.#ws = ws;
    ws.addEventListener('open', () => {
      this.#retry = 0;
      this.#set({ status: 'open' });
      ws.send(JSON.stringify(this.#opts.hello()));
      this.#ping = setInterval(() => this.#raw({ type: 'ping' }), 20_000);
    });
    ws.addEventListener('message', (e) => {
      let m: ServerMessage;
      try {
        m = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      if (m.type === 'view') this.#set({ view: m.view as V, error: null, skew: m.now - Date.now() });
      else if (m.type === 'welcome') this.#opts.onWelcome?.(m.playerId, m.token);
      else if (m.type === 'job') this.#opts.onJob?.(m);
      else if (m.type === 'error') {
        const err = { message: m.message, code: m.code };
        this.#set({ error: err });
        if (m.code && FATAL.has(m.code)) {
          this.#opts.onFatal?.(err);
          if (m.code !== 'bad-token') this.close(); // bad-token: the page asks for a name and says hello again
        }
      }
    });
    ws.addEventListener('close', () => {
      if (this.#ping) clearInterval(this.#ping);
      this.#ping = null;
      if (this.#ws !== ws) return;
      this.#ws = null;
      if (this.#stopped) return this.#set({ status: 'closed' });
      this.#set({ status: 'connecting' });
      const delay = Math.min(5000, 400 * 2 ** this.#retry++);
      this.#timer = setTimeout(() => this.#connect(), delay);
    });
  }

  #raw(m: ClientMessage): boolean {
    if (this.#ws?.readyState !== WebSocket.OPEN) return false;
    this.#ws.send(JSON.stringify(m));
    return true;
  }

  /** say hello again (e.g. after the player typed a name) */
  hello(): void {
    if (this.#stopped) {
      this.#stopped = false;
      this.#connect();
    } else this.#raw(this.#opts.hello());
  }
  host(command: HostCommand): boolean {
    return this.#raw({ type: 'host', command });
  }
  player(action: PlayerAction): boolean {
    return this.#raw({ type: 'player', action });
  }
  /** milliseconds left until a server-clock deadline */
  left(deadline: number): number {
    return Math.max(0, deadline - (Date.now() + this.state.skew));
  }

  close(): void {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#ws?.close();
    this.#ws = null;
    this.#set({ status: 'closed' });
  }
}

/** /party/ws on the page's origin (pass `location`). */
export const partySocketUrl = (loc: { protocol: string; host: string }): string => `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/party/ws`;
