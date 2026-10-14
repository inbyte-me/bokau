<!-- Everything after joining, driven by the room's view: lobby → casting → turns → the show on the TV. -->
<script lang="ts">
  import { type PartyClient, PLAYER_COLORS, type PlayerView } from '@doblaje/party';
  import CharacterTag from '@doblaje/ui/components/CharacterTag.svelte';
  import Countdown from '@doblaje/ui/components/Countdown.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { Live } from '@doblaje/ui/live.svelte';
  import Ambience from './Ambience.svelte';
  import BoardStrip from './BoardStrip.svelte';
  import HostSheet from './HostSheet.svelte';
  import MyTurn from './MyTurn.svelte';
  import type { MixRender } from './render.svelte.ts';
  import { RoundAudio } from './round.svelte.ts';
  import ShowScreen from './ShowScreen.svelte';
  import Tasks from './Tasks.svelte';

  interface Props {
    client: PartyClient<PlayerView>;
    code: string;
    token: string;
    onleave: () => void;
    /** this phone renders the finished round's mix when the server asks (it is the host) */
    renderer: MixRender;
  }
  let { client, code, token, onleave, renderer }: Props = $props();

  const live = $derived(new Live(client));
  const st = $derived(live.current);
  const view = $derived(st.view);
  const cast = $derived(!!view?.mine.length);
  // in the round, even while the characters are still hidden (the scene downloads while they are being described)
  const inRound = $derived(!!view?.inRound);

  // the round's audio, created once per round (projectId is a primitive: it only changes with a new round)
  const projectId = $derived(inRound && token ? (view?.projectId ?? null) : null);
  const round = $derived(projectId ? new RoundAudio(code, token) : null);
  $effect(() => {
    const r = round;
    window.__phone = r; // like the studio's window.__app: for debugging and the e2e tests
    return () => r?.dispose();
  });

  const GAME: Record<PlayerView['mode'], string> = {
    dub: t('Dub the scene'),
    badlip: t('Bad Lip Reading'),
    telenovela: t('Telenovela'),
    genre: t('Genre Swap'),
    blind: t('Blind Dubbing'),
    trailer: t('Trailer Director'),
  };
  // my colour on the TV (players are coloured by join order)
  const myColor = $derived.by(() => {
    const i = view?.players.findIndex((p) => p.id === view.me?.id) ?? -1;
    return PLAYER_COLORS[(i < 0 ? 0 : i) % PLAYER_COLORS.length];
  });
  const myTurn = $derived(view?.phase === 'playing' && !!view.turn?.mine && !!view.line);
  const someoneRecording = $derived(view?.phase === 'playing' && !!view.turn && !view.turn.mine);
  // the room asks this phone to write or vote (the trailer game, while others record)
  const asked = $derived((view?.phase === 'cards' || view?.phase === 'pitch' || view?.phase === 'playing') && !!view.tasks.length);
</script>

{#snippet ready()}
  {#if !round?.ready}
    <button id="ready" class="primary big" onclick={() => round?.getReady()} disabled={!round?.loaded}>{t('Headphones on, I am ready')}</button>
  {:else}
    <p class="ok" id="ready-ok">{t('Ready. Watch the TV.')}</p>
  {/if}
{/snippet}

{#if st.status !== 'open'}
  <div class="banner" role="status">{t('Reconnecting…')}</div>
{/if}
{#if st.error && st.status === 'open'}
  <div class="banner error" role="alert">{st.error.message}</div>
{/if}

{#if !view}
  <section class="screen center"><p class="lead">{t('Joining room {code}…', { code })}</p></section>
{:else if myTurn && view.line && view.turn && round?.loaded}
  {#key view.turn.n}
    <MyTurn {client} recorder={round.recorder} line={view.line} context={view.context} turn={view.turn} skew={st.skew} mode={view.mode} />
  {/key}
{:else}
  <section class="screen" id="room-screen" data-phase={view.phase} style:--me={myColor}>
    <header>
      <span class="brand"><span class="dot"></span>{t('Room {code}', { code })}</span>
      {#if view.me}<span class="me">{view.me.name}</span>{/if}
    </header>

    {#if view.phase === 'lobby'}
      <div class="me-card">
        <span class="initial" aria-hidden="true">{view.me?.name.slice(0, 1).toUpperCase()}</span>
        <div>
          <h1>{t('You are in')}</h1>
          <p class="lead">{t('Your colour on the TV.')}</p>
        </div>
      </div>
      <p class="eyebrow" id="game-name">{GAME[view.mode]}</p>
      <p class="lead">{view.isHost ? t('Choose the scene and the game, then invite your friends.') : t('The host is choosing the scene and the game. Keep your headphones at hand.')}</p>
      <ul class="people">
        {#each view.players as p (p.id)}<li class={[!p.connected && 'away']}>{p.name}</li>{/each}
      </ul>
    {:else if view.phase === 'casting'}
      <p class="eyebrow" id="game-name">{GAME[view.mode]}</p>
      {#if cast && view.mode === 'blind'}
        <h1>{t('You are in this round')}</h1>
        <p class="lead">
          {t('No script: you improvise {n} silent stretches of the scene. Nobody hears anything until the show.', {
            n: view.mine.reduce((a, c) => a + c.lines, 0),
          })}
        </p>
      {:else if cast && view.mode === 'trailer'}
        <h1>{t('You are in this trailer')}</h1>
        <p class="lead">
          {t('You perform {n} scenes with no script: the room tells you what happens in each. While the others record, you pitch, direct, vote and write reviews.', {
            n: view.mine.reduce((a, c) => a + c.lines, 0),
          })}
        </p>
        <div class="parts">
          {#each view.mine as c (c.id)}
            <CharacterTag name={c.name} color={c.color} size="big" />
            {#if c.card}<p class="card">{c.card}</p>{/if}
          {/each}
        </div>
        {@render ready()}
      {:else if cast}
        <p class="eyebrow">{t('You play')}</p>
        <div class="parts">
          {#each view.mine as c (c.id)}
            <CharacterTag name={c.name} color={c.color} size="big" />
            {#if c.card}<p class="card">{c.card}</p>{/if}
          {/each}
        </div>
        <p class="lead">{t('Put your headphones on. When it is your turn this phone shows your line, you record it, and send it.')}</p>
        {@render ready()}
      {:else}
        <h1>{t('Not this round')}</h1>
        <p class="lead">{t('Watch the TV. When someone records, put your headphones on: this phone plays music so you do not hear them.')}</p>
      {/if}
      <ul class="cast">
        {#each view.cast as c (c.player + c.character)}<li><CharacterTag name={c.character} color={c.color} /> <span>{c.player}</span></li>{/each}
      </ul>
    {:else if view.phase === 'playing' && view.turn?.mine}
      <h1>{t('Your turn')}</h1>
      <p class="lead" role="status">{round?.error ? t('The scene could not load.') : t('Loading your scene…')}</p>
    {:else if asked}
      <Tasks {client} {view} {code} {token} skew={st.skew} />
    {:else if view.phase === 'cards' || view.phase === 'pitch' || (view.phase === 'playing' && !view.turn)}
      <h1>{t('One moment')}</h1>
      <p class="lead" role="status">{t('The room is still deciding. Look at the TV.')}</p>
    {:else if view.phase === 'playing' && view.turn}
      <p class="eyebrow">{t('Recording now')}</p>
      <h1 class="who" id="now-recording">{view.turn.player}</h1>
      <p><CharacterTag name={view.turn.character} color={view.turn.color} /></p>
      <p class="lead">{t('Headphones on. No peeking, no listening.')}</p>
      <p class="timer"><Countdown deadline={view.turn.deadline} skew={st.skew} /></p>
      <p class="progress">{t('Line {n} of {total}', { n: view.progress.done + 1, total: view.progress.total })}</p>
    {:else if view.phase === 'compiling'}
      <h1>{t('Putting it together…')}</h1>
      <p class="lead">{t('Look at the TV.')}</p>
    {:else if view.phase === 'show' && view.board.result}
      <ShowScreen board={view.board} {code} {token} skew={st.skew} />
    {:else if view.phase === 'show'}
      <h1>{t('The show')}</h1>
      <p class="lead">{t('Headphones off. Here comes the dub. If there is a TV, look at it.')}</p>
    {/if}

    {#if view.phase === 'cards' || view.phase === 'pitch' || view.phase === 'playing'}<BoardStrip board={view.board} skew={st.skew} />{/if}
    {#if view.isHost && view.phase !== 'compiling'}<HostSheet {client} {view} {code} {token} />{/if}
    {#if renderer.state === 'rendering'}<p class="lead" role="status">{t('Preparing the result…')}</p>{/if}
    {#if renderer.state === 'error'}<p class="error" role="alert">{t('Could not prepare the result: {error}', { error: renderer.error })}</p>{/if}

    {#if round?.error}<p class="error" role="alert">{round.error}</p>{/if}
    <footer>
      <button class="ghost" onclick={onleave}>{t('Leave room')}</button>
    </footer>
  </section>
{/if}

<Ambience urls={view?.ambience ?? []} {token} active={someoneRecording} />
