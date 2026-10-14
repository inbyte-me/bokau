<!-- A podcast project: record (camera + mic) until there is media, then review, trim, add chapters and export. -->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { app } from '../../app.svelte.ts';
  import { screenBar } from '../../shell/bar.svelte.ts';
  import { store } from '../../store.svelte.ts';
  import PodcastReview from './PodcastReview.svelte';
  import RecorderView from './RecorderView.svelte';

  const ready = $derived(store.read(['media'], (p) => !!p.media?.ready, false));
  const name = $derived(store.read(['meta'], (p) => p.name, ''));

  onMount(() => screenBar.show(bar));
  onDestroy(() => {
    app.engine.stop();
    void store.flush();
    app.mic.close();
  });
</script>

{#snippet bar()}
  <span class="small dim proj-name">{name}</span>
{/snippet}

<div class="pod">
  {#if ready}<PodcastReview />{:else}<RecorderView />{/if}
</div>
