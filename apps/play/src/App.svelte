<!-- The phone: join a room by code and name, then follow the room. A token in localStorage brings the same
     player back after a reload or a dropped Wi-Fi; ?seat=n keeps several test players apart in one browser. -->
<script lang="ts">
  import { PartyClient, type PlayerView } from '@doblaje/party';
  import { t } from '@doblaje/ui/i18n';
  import { forgetToken, loadHostKey, loadName, loadToken, saveHostKey, saveName, saveToken } from './identity.ts';
  import Join from './Join.svelte';
  import Room from './Room.svelte';
  import { MixRender } from './render.svelte.ts';
  import { serverUrl, socketUrl } from './server.ts';

  const params = new URLSearchParams(location.search);
  const seat = params.get('seat') ?? '';
  const initialCode = (params.get('room') ?? '').toUpperCase();
  let code = $state(initialCode);
  let name = $state(loadName(seat));
  let token = $state<string | null>(null);
  let client = $state<PartyClient<PlayerView> | null>(null);
  let error = $state('');
  const renderer = new MixRender();

  function join(nextCode: string, nextName?: string) {
    client?.close();
    code = nextCode.toUpperCase();
    if (nextName !== undefined) {
      name = nextName;
      saveName(seat, name);
    }
    token = loadToken(code, seat);
    error = '';
    const c = new PartyClient<PlayerView>({
      url: socketUrl(),
      // the host key (a room this phone created) makes it the host as well as a player; any phone can render the mix when asked
      hello: () => ({
        type: 'hello-player',
        code,
        token: token ?? undefined,
        name: token ? undefined : name,
        hostKey: loadHostKey(code, seat) ?? undefined,
        worker: true,
      }),
      onJob: () => token && void renderer.run(code, token),
      onWelcome: (_id, tok) => {
        token = tok;
        saveToken(code, seat, tok);
      },
      onFatal: (e) => {
        // the room is gone, or it no longer knows this phone: back to the join form, name kept
        forgetToken(code, seat);
        token = null;
        error = e.code === 'bad-token' && !name ? '' : e.message;
        c.close();
        if (client === c) client = null;
      },
    });
    client = c;
    if (!params.get('room') || params.get('room') !== code) history.replaceState(null, '', `?room=${code}${seat ? `&seat=${seat}` : ''}`);
  }

  /** Open a room from this phone (no TV needed): the server gives its code and the key that makes this phone the host. */
  async function create(nextName: string) {
    error = '';
    try {
      const r = await fetch(serverUrl('/api/party/rooms'), { method: 'POST' });
      const body = (await r.json()) as { code?: string; hostKey?: string; error?: string };
      if (!r.ok || !body.code || !body.hostKey) throw new Error(body.error ?? `HTTP ${r.status}`);
      saveHostKey(body.code, seat, body.hostKey);
      join(body.code, nextName);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function leave() {
    forgetToken(code, seat);
    client?.close();
    client = null;
    token = null;
  }

  // came back to a room this phone already joined: go straight in
  if (initialCode && loadToken(initialCode, seat)) join(initialCode);
</script>

<main class="phone" aria-label={t('Doblaje party')}>
  {#if client}
    <Room {client} {code} token={token ?? ''} onleave={leave} {renderer} />
  {:else}
    <Join {code} {name} {error} onjoin={join} oncreate={create} />
  {/if}
</main>
