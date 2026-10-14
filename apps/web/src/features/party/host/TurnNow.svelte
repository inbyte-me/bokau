<!-- Who is recording now (in their colour), as whom, how it is going, and the clock. Shared by the boards of every game. -->
<script lang="ts">
  import { playerColor } from '@doblaje/party';
  import CharacterTag from '@doblaje/ui/components/CharacterTag.svelte';
  import Countdown from '@doblaje/ui/components/Countdown.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { getHost } from './host.svelte.ts';

  interface Props {
    /** "Line 3 of 8", "Scene 3 of 6": where the round is */
    eyebrow: string;
    /** the player invents the words: no character to show */
    improvised?: boolean;
  }
  let { eyebrow, improvised = false }: Props = $props();

  const host = getHost();
  const room = $derived(host.room);
  const turn = $derived(room?.turn ?? null);
  const line = $derived(turn && room ? room.lines.find((l) => l.cueId === turn.cueId) : undefined);
  const char = $derived(line && room ? room.characters.find((c) => c.id === line.character) : undefined);
  const player = $derived(turn && room ? room.players.find((p) => p.id === turn.playerId) : undefined);
  const STATUS: Record<string, string> = {
    called: t('Getting ready'),
    recording: t('Recording'),
    reviewing: t('Listening back'),
    uploading: t('Sending'),
  };
</script>

{#if room && turn}
  <div class="now" style:--c={playerColor(room, turn.playerId)}>
    <p class="eyebrow">{eyebrow}</p>
    <h1 id="now-recording">{player?.name}</h1>
    {#if improvised}
      <p class="as">{t('is improvising')}</p>
    {:else}
      <p class="as">{t('as')} <CharacterTag name={char?.name ?? '?'} color={char?.color ?? '#888'} size="big" /></p>
    {/if}
    <p class={['status', turn.status]} data-status={turn.status}>{STATUS[turn.status] ?? ''}</p>
  </div>
  <div class="clock">
    <div class="timer"><Countdown deadline={turn.deadline} skew={host.state?.skew ?? 0} /></div>
    <div class="dim">{t('seconds left')}</div>
  </div>
{/if}

<style>
  .now {
    grid-area: now;
    border-left: 10px solid var(--c);
    padding-left: 1.4rem;
  }
  .eyebrow {
    margin: 0;
    color: var(--faint);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  h1 {
    margin: 0.2rem 0;
    font-family: var(--display);
    font-size: clamp(3rem, 7vw, 5.6rem);
    line-height: 1;
  }
  .as {
    margin: 0;
    font-size: 1.4rem;
    color: var(--dim);
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }
  .status {
    margin: 0.8rem 0 0;
    font-size: 1.4rem;
    color: var(--dim);
  }
  .status.recording {
    color: var(--signal-text);
  }
  .clock {
    grid-area: clock;
    text-align: right;
  }
  .timer {
    font-size: clamp(3.5rem, 8vw, 6rem);
    line-height: 1;
  }
  .dim {
    color: var(--dim);
  }
  @media (prefers-reduced-motion: no-preference) {
    .status.recording::before {
      content: '';
      display: inline-block;
      width: 0.7em;
      height: 0.7em;
      margin-right: 0.5em;
      border-radius: 50%;
      background: var(--signal);
      animation: blink 1.1s steps(2, start) infinite;
    }
    @keyframes blink {
      to {
        visibility: hidden;
      }
    }
  }
</style>
