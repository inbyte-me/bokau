<!-- During the round: who records now (and as whom), the time left, every line as a dot in its player's colour
     (done, now, coming), and the host's controls. No script on the TV: the result is a surprise. -->
<script lang="ts">
  import { t } from '@doblaje/ui/i18n';
  import HostControls from './HostControls.svelte';
  import { getHost } from './host.svelte.ts';
  import LineDots from './LineDots.svelte';
  import TurnNow from './TurnNow.svelte';

  const host = getHost();
  const room = $derived(host.room);
</script>

{#if room?.turn}
  <section class="board" id="turn-board">
    <TurnNow eyebrow={t('Line {n} of {total}', { n: room.results.length + 1, total: room.queue.length })} improvised={room.settings.mode === 'blind'} />
    <LineDots />
    <p class="headphones">{t('Everyone else: headphones on.')}</p>
    <HostControls />
  </section>
{/if}

<style>
  .board {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'now clock' 'dots dots' 'head head' 'ctl ctl';
    gap: 1.4rem 2rem;
    align-content: start;
  }
  .headphones {
    grid-area: head;
    margin: 0;
    font-size: 1.3rem;
    color: var(--cue);
  }
</style>
