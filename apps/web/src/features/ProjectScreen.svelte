<!-- An open project: loads it into the store, then shows the screen for its mode: the studio (dubbing), the podcast
     screen, or a party round (which can also be opened in the studio, /p/<id>/studio). -->
<script lang="ts">
  import { t } from '@doblaje/ui/i18n';
  import { store } from '../store.svelte.ts';
  import PartyRound from './party/PartyRound.svelte';
  import Podcast from './podcast/Podcast.svelte';
  import Studio from './studio/Studio.svelte';

  interface Props {
    id: string;
    /** a party round opens as a round; this opens it in the studio instead */
    studio?: boolean;
    onerror: (e: unknown) => void;
  }
  let { id, studio = false, onerror }: Props = $props();
</script>

{#await store.open(id)}
  <div class="hint" id="loading">{t('Loading…')}</div>
{:then project}
  {#if project.mode === 'podcast'}
    <Podcast />
  {:else if project.mode === 'party' && !studio}
    <PartyRound {project} />
  {:else}
    <Studio {project} />
  {/if}
{:catch e}
  <span hidden {@attach () => onerror(e)}></span>
{/await}

