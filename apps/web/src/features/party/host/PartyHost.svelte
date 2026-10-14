<!-- The TV in a party room. A show in steps: pick the scene, the game, gather the players; the round gets ready; the
     cast is revealed; turns run on the phones while the TV keeps score; then the show. The header always says how
     to join. The server runs the game (packages/party); this screen sends the host's commands. -->
<script lang="ts">
  import { t } from '@doblaje/ui/i18n';
  import { onDestroy, untrack } from 'svelte';
  import { go } from '../../../router.svelte.ts';
  import CardsBoard from './CardsBoard.svelte';
  import { PartyHostState, setHost } from './host.svelte.ts';
  import PitchBoard from './PitchBoard.svelte';
  import RoomHeader from './RoomHeader.svelte';
  import RoundCasting from './RoundCasting.svelte';
  import Show from './Show.svelte';
  import StepGame from './StepGame.svelte';
  import StepPlayers from './StepPlayers.svelte';
  import StepScene from './StepScene.svelte';
  import StepScreen from './StepScreen.svelte';
  import TrailerBoard from './TrailerBoard.svelte';
  import TurnBoard from './TurnBoard.svelte';

  interface Props {
    /** a library clip to start with (#/party?clip=…, from the clip's "Play at a party") */
    clip?: string | null;
  }
  let { clip = null }: Props = $props();

  const host = new PartyHostState(untrack(() => clip));
  setHost(host);
  untrack(() => void host.open());
  onDestroy(() => host.close());

  const room = $derived(host.room);
  // a lobby without a scene starts at the first step
  const step = $derived(room?.phase === 'lobby' && !room.clip ? 'scene' : host.step);
</script>

<div class="party-room" id="party-room" data-phase={room?.phase ?? 'connecting'} data-step={step}>
  <RoomHeader />
  <main class="room-main">
    {#if host.error}
      <StepScreen title={t('Could not open a party room')} lead={host.error}>
        <button onclick={() => host.open(true)}>{t('Try again')}</button>
      </StepScreen>
    {:else if !room}
      <p class="lead">{t('Opening the room…')}</p>
    {:else if room.phase === 'lobby'}
      {#if step === 'scene'}<StepScene />{:else if step === 'game'}<StepGame />{:else}<StepPlayers />{/if}
    {:else if room.phase === 'cards'}
      <CardsBoard />
    {:else if room.phase === 'casting'}
      <RoundCasting />
    {:else if room.phase === 'pitch'}
      <PitchBoard />
    {:else if room.phase === 'playing'}
      {#if room.trailer}<TrailerBoard />{:else}<TurnBoard />{/if}
    {:else if room.phase === 'compiling'}
      <StepScreen
        title={t('Putting it together…')}
        lead={room.trailer ? t('Cutting the scenes together with title cards, then every take goes on its own track over them.') : t('Cutting the scene down to what you dubbed, then every take goes on its own track over it.')}
      >
        <span></span>
      </StepScreen>
    {:else if room.phase === 'show' && room.projectId}
      {@const projectId = room.projectId}
      <Show
        {projectId}
        slice={room.slice}
        recorded={room.results.filter((r) => r.file).length}
        total={room.results.length}
        scenes={!!room.trailer}
        onagain={() => host.send({ type: 'cast' })}
        onchangegame={() => {
          host.send({ type: 'again' });
          host.step = 'game';
        }}
        onchangescene={() => {
          host.send({ type: 'again' });
          host.step = 'scene';
        }}
        onstudio={() => go(`/p/${projectId}`)}
      />
    {/if}
    {#if host.state?.error}<p class="error" role="alert">{host.state.error.message}</p>{/if}
    {#if host.state && host.state.status !== 'open'}<p class="dim" role="status">{t('Reconnecting…')}</p>{/if}
  </main>
</div>

<style>
  .party-room {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-x: hidden;
    overflow-y: auto; /* screen: fits when roomy, scrolls as a whole when it cannot */
  }
  .room-main {
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto; /* scroll */
    padding: 1.8rem 3rem;
    display: flex;
    flex-direction: column;
  }
  :global(html.tv) .room-main {
    padding: 2rem 5%;
  }
  .lead,
  .dim {
    color: var(--dim);
  }
  .error {
    color: var(--signal-text);
  }
  @media (max-width: 999px) {
    .room-main {
      overflow: visible;
      padding: 1rem 1.2rem;
    }
  }
</style>
