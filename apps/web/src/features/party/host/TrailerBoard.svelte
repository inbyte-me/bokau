<!-- Trailer, during the scenes: who performs now, what the rest of the room is writing for the next scene (or the title),
     what the next performer is reviewing, and the host's controls. -->
<script lang="ts">
  import { playerColor } from '@doblaje/party';
  import { t } from '@doblaje/ui/i18n';
  import ContestBoard from './ContestBoard.svelte';
  import HostControls from './HostControls.svelte';
  import { getHost } from './host.svelte.ts';
  import LineDots from './LineDots.svelte';
  import TurnNow from './TurnNow.svelte';

  const host = getHost();
  const room = $derived(host.room);
  const tr = $derived(room?.trailer ?? null);
  const open = $derived(room?.contests.filter((c) => c.kind !== 'card' && (c.stage !== 'done' || (c.fill && c.text === null))) ?? []);
  /** the next performer writes a review while this scene is recorded */
  const critic = $derived.by(() => {
    if (!room || !tr || tr.next === 0) return null;
    const next = tr.scenes[tr.next];
    if (!next) return null;
    return {
      name: room.players.find((p) => p.id === next.playerId)?.name ?? '?',
      color: playerColor(room, next.playerId),
      done: tr.reviews.some((r) => r.gap === tr.next - 1),
    };
  });
  const scene = $derived(tr ? Math.min(tr.next, tr.scenes.length) : 0);
</script>

{#if room && tr}
  <section class="board" id="trailer-board" data-holding={tr.holding ? '' : undefined}>
    {#if room.turn}
      <TurnNow eyebrow={t('Scene {n} of {total}', { n: scene, total: tr.scenes.length })} improvised />
    {:else}
      <div class="wait" id="trailer-wait">
        <p class="eyebrow">{tr.next >= tr.scenes.length ? t('The last scene is in') : t('Scene {n} of {total}', { n: scene + 1, total: tr.scenes.length })}</p>
        <h1>{tr.next >= tr.scenes.length ? t('Waiting for the title') : t('Waiting for its direction')}</h1>
      </div>
    {/if}
    <div class="side">
      {#each open as c (c.id)}
        <ContestBoard contest={c} reveal={c.kind !== 'direction'} title={c.kind === 'title' ? t('The title') : t('Direction for scene {n}', { n: (c.scene ?? 0) + 1 })} />
      {/each}
      {#if critic}
        <p class={['critic', critic.done && 'done']} style:--c={critic.color}>
          {critic.done ? t('{name} has written a review.', { name: critic.name }) : t('{name} is writing a review.', { name: critic.name })}
        </p>
      {/if}
    </div>
    <LineDots />
    <HostControls />
  </section>
{/if}

<style>
  .board {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'now clock' 'side side' 'dots dots' 'ctl ctl';
    gap: 1.4rem 2rem;
    align-content: start;
  }
  .wait {
    grid-area: now;
  }
  .wait h1 {
    margin: 0.2rem 0;
    font-family: var(--display);
    font-size: clamp(2.4rem, 5vw, 4rem);
  }
  .eyebrow {
    margin: 0;
    color: var(--faint);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .side {
    grid-area: side;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 1rem;
    align-items: start;
  }
  .critic {
    margin: 0;
    padding: 0.7rem 1rem;
    border-left: 6px solid var(--c);
    color: var(--dim);
    font-size: 1.2rem;
  }
  .critic.done {
    color: var(--text);
  }
</style>
