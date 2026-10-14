<!-- The phone: join a room by code and name, then follow the room. A token in localStorage brings the same
     player back after a reload or a dropped Wi-Fi; ?seat=n keeps several test players apart in one browser. -->
<script lang="ts">
  import { PartyClient, type PlayerView } from '@doblaje/party';
  import { t } from '@doblaje/ui/i18n';
  import { onMount } from 'svelte';
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
  /** who is hosting here, and whether a room needs a sign-in (the server decides: a laptop's rooms are anonymous) */
  let me = $state<{ loginRequired: boolean; person: { id: string; name: string } | null }>({ loginRequired: false, person: null });
  onMount(() => {
    fetch(serverUrl('/api/me'), { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((m: typeof me | null) => {
        if (!m) return;
        me = m;
        if (m.person && !name) name = m.person.name;
      })
      .catch(() => {});
  });
  /** go and sign in, and come back to this page */
  const signIn = () => {
    location.href = serverUrl(`/auth/login?return=${encodeURIComponent(location.pathname + location.search)}`);
  };

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
    if (nextName) saveName(seat, nextName);
    if (me.loginRequired && !me.person) return signIn();
    try {
      const r = await fetch(serverUrl('/api/party/rooms'), { method: 'POST', credentials: 'include' });
      const body = (await r.json()) as { code?: string; hostKey?: string; error?: string; code_?: string };
      if (r.status === 401) return signIn(); // the session ended meanwhile
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
    <Join {code} {name} {error} onjoin={join} oncreate={create} loginRequired={me.loginRequired} person={me.person} />
  {/if}
</main>
