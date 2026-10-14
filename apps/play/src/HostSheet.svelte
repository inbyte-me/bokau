<!-- The host's side of a room, on a phone: pick the clip and the game, invite friends, start, and steer the round. It is shown
     to whichever phone holds the room's host key (the one that created the room), and does what the TV's setup screens do:
     both send the same commands to the server, which runs the room. -->
<script lang="ts">
  import { type PartyClient, type PlayerView, type RoomSettings } from '@doblaje/party';
  import LanguageSelect from '@doblaje/party-ui/components/LanguageSelect.svelte';
  import RoundControls from '@doblaje/party-ui/components/RoundControls.svelte';
  import { GAMES } from '@doblaje/party-ui/games';
  import { t } from '@doblaje/ui/i18n';
  import { onMount } from 'svelte';
  import { serverUrl } from './server.ts';

  interface Props {
    client: PartyClient<PlayerView>;
    view: PlayerView;
    code: string;
    token: string;
  }
  let { client, view, code, token }: Props = $props();
  const board = $derived(view.board);
  const s = $derived(board.settings);
  const games = GAMES();
  const game = $derived(games.find((g) => g.mode === s.mode) ?? games[0]);
  const set = (settings: Partial<RoomSettings>) => client.host({ type: 'settings', settings });
  const connected = $derived(board.players.filter((p) => p.connected).length);
  const needed = $derived(s.mode === 'trailer' ? 2 : 1);

  interface ClipInfo {
    id: string;
    name: string;
    duration: number;
    characters: string[];
    lines: number;
  }
  let clips = $state<ClipInfo[] | null>(null);
  let clipError = $state('');
  onMount(() => {
    fetch(serverUrl(`/api/party/rooms/${code}/clips`), { headers: { 'x-party-token': token } })
      .then(async (r) =>
        r.ok
          ? ((await r.json()) as ClipInfo[])
          : Promise.reject(new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`)),
      )
      .then((list) => {
        clips = list;
      })
      .catch((e: unknown) => {
        clipError = e instanceof Error ? e.message : String(e);
      });
  });
  const poster = (id: string) => serverUrl(`/party/${code}/clips/${id}/poster.jpg?t=${encodeURIComponent(token)}`);

  let copied = $state(false);
  async function invite() {
    const url = view.joinUrl;
    const text = t('Join my party: {url}', { url });
    try {
      if (navigator.share) await navigator.share({ title: 'Doblaje', text, url });
      else {
        await navigator.clipboard.writeText(url);
        copied = true;
        setTimeout(() => (copied = false), 2000);
      }
    } catch {}
  }
  const phase = $derived(board.phase);
</script>

<section class="host" id="host-sheet" data-phase={phase}>
  <h2>{t('You are the host')}</h2>

  {#if phase === 'lobby'}
    <div class="invite">
      <p class="code" id="host-code">{code}</p>
      <button id="invite" class="big" onclick={invite}>{copied ? t('Link copied') : t('Invite friends')}</button>
    </div>

    <h3>{t('Scene')}</h3>
    {#if clips === null && !clipError}
      <p class="dim">{t('Loading the clips…')}</p>
    {:else if clipError}
      <p class="error" role="alert">{clipError}</p>
    {:else if !clips?.length}
      <p class="dim">{t('This server has no clips ready yet.')}</p>
    {:else}
      <ul class="clips" role="radiogroup" aria-label={t('Scene')}>
        {#each clips as c (c.id)}
          <li>
            <button class={['clip', board.clip?.id === c.id && 'sel']} role="radio" aria-checked={board.clip?.id === c.id} data-clip={c.id} onclick={() => client.host({ type: 'pick-clip', clipId: c.id })}>
              <img src={poster(c.id)} alt="" loading="lazy" />
              <span class="name">{c.name}</span>
              <span class="dim">{c.characters.join(', ')}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <h3>{t('Game')}</h3>
    <ul class="games" role="radiogroup" aria-label={t('Game')}>
      {#each games as g (g.mode)}
        <li>
          <button class={['game', s.mode === g.mode && 'sel']} role="radio" aria-checked={s.mode === g.mode} data-mode={g.mode} onclick={() => set({ mode: g.mode })}>
            <span class="name">{g.title}</span>
            <span class="dim">{g.pitch}</span>
          </button>
        </li>
      {/each}
    </ul>
    <LanguageSelect value={s.language} onchange={(language) => set({ language })} />
    {#if s.mode === 'trailer'}
      <label class="field"
        >{t('Scenes')}
        <select id="scenes" value={s.scenes} onchange={(e) => set({ scenes: Number(e.currentTarget.value) })}>
          {#each [2, 4, 6, 8, 12] as n (n)}<option value={n}>{n}</option>{/each}
        </select></label
      >
    {:else if s.mode !== 'blind'}
      <label class="check"><input id="cards" type="checkbox" checked={s.cards} onchange={(e) => set({ cards: e.currentTarget.checked })} /> {t('Describe the characters first')}</label>
    {/if}
    <button id="host-cast" class="primary big" disabled={!board.clip || connected < needed} onclick={() => client.host({ type: 'cast' })}>
      {!board.clip ? t('Pick a scene first') : connected < needed ? t('Waiting for players') : t('Start the round')}
    </button>
    <p class="dim">{game.title}: {game.pitch}</p>
  {:else if phase === 'casting'}
    <button id="host-begin" class="primary big" disabled={board.preparing} onclick={() => client.host({ type: 'begin' })}>
      {board.preparing ? t('Writing the lines…') : t('Start')}
    </button>
    <button class="ghost" onclick={() => client.host({ type: 'again' })}>{t('Back')}</button>
  {:else if phase === 'cards' || phase === 'pitch' || phase === 'playing'}
    <RoundControls send={(c) => client.host(c)} turns={phase === 'playing'} />
  {:else if phase === 'show'}
    <div class="after">
      <button id="host-again" class="primary big" onclick={() => client.host({ type: 'cast' })}>{t('Another round')}</button>
      <button class="big" onclick={() => client.host({ type: 'again' })}>{t('Change the game or the scene')}</button>
    </div>
  {/if}
</section>

<style>
  .host {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border: 1px dashed var(--line2);
    border-radius: 12px;
  }
  h2 {
    margin: 0;
    font-size: 0.8rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--faint);
  }
  h3 {
    margin: 6px 0 0;
    font-size: 1rem;
  }
  .invite {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .code {
    margin: 0;
    font: 700 2rem var(--mono);
    letter-spacing: 0.25em;
  }
  .invite button {
    flex: 1;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .clip,
  .game {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    text-align: left;
  }
  .clip img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 8px;
    background: #000;
  }
  .sel {
    border-color: var(--signal);
    box-shadow: inset 6px 0 0 var(--signal);
  }
  .name {
    font-weight: 600;
  }
  .dim {
    color: var(--dim);
    font-size: 0.9rem;
    margin: 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  select {
    font: inherit;
    padding: 10px;
    background: var(--panel2);
    color: inherit;
    border: 1px solid var(--line2);
    border-radius: 10px;
  }
  .check {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  .after {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
</style>
