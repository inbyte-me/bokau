// The TV's side of a party room: opens (or reopens) the room, keeps its socket, sends the host's commands, and holds
// which setup step the TV shows. Screens read it from context.
import { type HostCommand, type HostView, PartyClient, partySocketUrl, type Room } from '@doblaje/party';
import { getLang } from '@doblaje/ui/i18n';
import { Live } from '@doblaje/ui/live.svelte';
import { createContext } from 'svelte';
import { api } from '../../../api.ts';
import { TakeListener } from './listener.ts';
import { type HostRoom, loadRoom, saveRoom } from './room.ts';

/** Before a round: choose the scene, then the game, then gather the players. */
export type SetupStep = 'scene' | 'game' | 'players';

export class PartyHostState {
  client = $state.raw<PartyClient<HostView> | null>(null);
  error = $state('');
  step = $state<SetupStep>('scene');
  #live = $derived(this.client ? new Live(this.client) : null);
  #unlisten: (() => void) | null = null;
  /** a clip to pick as soon as the room is open (#/party?clip=…) */
  #wantClip: string | null = null;
  /** a room this TV just created: it gets the TV's language */
  #newRoom = false;

  constructor(clip: string | null = null) {
    this.#wantClip = clip;
  }

  get state() {
    return this.#live?.current ?? null;
  }
  get view(): HostView | null {
    return this.state?.view ?? null;
  }
  get room(): Room | null {
    return this.view?.room ?? null;
  }
  get connected(): number {
    return this.room?.players.filter((p) => p.connected).length ?? 0;
  }

  async open(fresh = false): Promise<void> {
    this.error = '';
    let r: HostRoom | null = fresh ? null : loadRoom();
    if (!r) {
      try {
        r = await api.post<HostRoom>('/api/party/rooms');
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
        return;
      }
      saveRoom(r);
      this.#newRoom = true;
    }
    const room = r;
    this.#unlisten?.();
    this.client?.close();
    const c = new PartyClient<HostView>({
      url: partySocketUrl(location),
      hello: () => ({ type: 'hello-host', code: room.code, hostKey: room.hostKey }),
      // the server restarted (rooms live in memory): open a new one
      onFatal: (e) => {
        if (e.code === 'no-room' || e.code === 'not-allowed') {
          saveRoom(null);
          void this.open(true);
        }
      },
    });
    this.client = c;
    // the TV transcribes new takes as they arrive (I/O, not UI state)
    const listener = new TakeListener(c);
    // a server that listens to takes itself needs no TV for it (the TV only does it when the server cannot)
    let serverListens = false;
    api
      .get<{ transcribes?: boolean }>('/api/party/info')
      .then((info) => {
        serverListens = !!info.transcribes;
      })
      .catch(() => {});
    this.#unlisten = c.subscribe((s) => {
      if (!s.view) return;
      if (!serverListens) listener.update(s.view.room);
      // a new room plays in the TV's language until the host picks another
      if (this.#newRoom && s.view.room.phase === 'lobby') {
        this.#newRoom = false;
        const ui = getLang();
        if (s.view.room.settings.language !== ui) this.send({ type: 'settings', settings: { language: ui } });
      }
      const want = this.#wantClip;
      if (want && s.view.room.phase === 'lobby') {
        this.#wantClip = null;
        if (s.view.room.clip?.id !== want) this.pickClip(want);
        else this.step = 'game';
      }
    });
  }

  send(c: HostCommand): void {
    this.client?.host(c);
  }
  pickClip(id: string): void {
    this.send({ type: 'pick-clip', clipId: id });
    this.step = 'game';
  }

  close(): void {
    this.#unlisten?.();
    this.client?.close();
  }
}

export const [getHost, setHost] = createContext<PartyHostState>();
