<!-- The room at a glance for a phone with no TV to look at: who is in (and who is recording), the clock, and how far the
     round is. Drawn from the public board the server sends every client. -->
<script lang="ts">
  import type { Board } from '@doblaje/party';
  import Countdown from '@doblaje/ui/components/Countdown.svelte';
  import { t } from '@doblaje/ui/i18n';

  interface Props {
    board: Board;
    skew: number;
  }
  let { board, skew }: Props = $props();
  const name = (id: string) => board.players.find((p) => p.id === id)?.name ?? '?';
</script>

<section class="strip" id="board-strip" aria-label={t('The room')}>
  <ul class="who">
    {#each board.players as p (p.id)}
      <li class={[!p.connected && 'away', board.turn?.playerId === p.id && 'now']} style:--c={p.color}>{p.name}</li>
    {/each}
  </ul>
  {#if board.turn}
    <p class="now">{t('{name} is recording', { name: name(board.turn.playerId) })} <Countdown deadline={board.turn.deadline} {skew} /></p>
  {/if}
  {#if board.dots.length}
    <ol class="dots" aria-label={t('Progress')}>
      {#each board.dots as d (d.id)}<li class={['dot', d.state]} style:--c={d.color}></li>{/each}
    </ol>
  {/if}
  {#if board.trailer?.logline}<p class="logline">{t('The movie: {pitch}', { pitch: board.trailer.logline })}</p>{/if}
</section>

<style>
  .strip {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
  }
  p {
    margin: 0;
  }
  .who,
  .dots {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .who li {
    padding: 2px 10px;
    border-radius: 999px;
    border: 2px solid var(--c);
    font-size: 0.9rem;
  }
  .who li.now {
    background: var(--c);
    color: #121211;
  }
  .who li.away {
    opacity: 0.45;
  }
  .now {
    color: var(--dim);
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--c);
    box-sizing: border-box;
    opacity: 0.45;
  }
  .dot.done {
    background: var(--c);
    opacity: 1;
  }
  .dot.skipped {
    opacity: 0.25;
  }
  .dot.now {
    opacity: 1;
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  .logline {
    color: var(--dim);
    font-size: 0.9rem;
  }
</style>
