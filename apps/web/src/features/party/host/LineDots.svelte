<!-- The round at a glance: one dot per turn in the performer's colour (done: filled, now: ringed, coming: faint). -->
<script lang="ts">
  import { playerColor } from '@doblaje/party';
  import { t } from '@doblaje/ui/i18n';
  import { getHost } from './host.svelte.ts';

  const host = getHost();
  const room = $derived(host.room);
  const dots = $derived(
    room
      ? room.queue.map((id) => {
          const l = room.lines.find((x) => x.cueId === id);
          const role = room.cast.find((c) => c.characterId === l?.character);
          const done = room.results.find((r) => r.cueId === id);
          return {
            id,
            color: role ? playerColor(room, role.playerId) : '#888',
            state: done ? (done.file ? 'done' : 'skipped') : id === room.turn?.cueId ? 'now' : 'next',
          };
        })
      : [],
  );
</script>

<ol class="dots" aria-label={t('Lines of the round')}>
  {#each dots as d (d.id)}<li class={['dot', d.state]} style:--c={d.color}></li>{/each}
</ol>

<style>
  .dots {
    grid-area: dots;
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .dot {
    flex: none;
    box-sizing: border-box;
    width: 1.1rem;
    height: 1.1rem;
    padding: 0;
    border-radius: 50%;
    border: 2px solid var(--c);
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
    outline-offset: 3px;
  }
</style>
