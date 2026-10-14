<!-- Step 1: which prepared clip tonight's round plays. Clips need characters (Voices → Prepare all) to be playable. -->
<script lang="ts">
  import type { ProjectSummary } from '@doblaje/core';
  import { fmtClock } from '@doblaje/ui';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { api } from '../../../api.ts';
  import { go } from '../../../router.svelte.ts';
  import { getHost } from './host.svelte.ts';
  import StepScreen from './StepScreen.svelte';

  const host = getHost();
  let clips = $state.raw<ProjectSummary[] | null>(null);
  let error = $state('');
  api
    .projects('clips')
    .then((list) => (clips = list.filter((c) => c.ready)))
    .catch((e: unknown) => (error = e instanceof Error ? e.message : String(e)));
  const current = $derived(host.room?.clip?.id ?? null);
</script>

<StepScreen title={t('Pick a scene')} lead={t('Choose a clip from the library. Players can join while you set up.')}>
  {#if error}<p class="error">{error}</p>{/if}
  {#if clips === null}
    <p class="lead">{t('Loading the library…')}</p>
  {:else if !clips.length}
    <div class="empty">
      <p>{t('The clip library is empty. Add a video to the library and prepare it (subtitles and voices) first.')}</p>
      <button onclick={() => go('/')}><Icon name="back" />{t('Library')}</button>
    </div>
  {:else}
    <ul class="clip-grid" id="party-clips">
      {#each clips as c (c.id)}
        <li>
          <button class={['clip-card', current === c.id && 'sel']} data-clip={c.id} disabled={!c.characters.length} onclick={() => host.pickClip(c.id)}>
            <span class="poster" style:background-image={c.poster ? `url(${c.poster})` : undefined}>
              <span class="len mono">{fmtClock(c.duration)}</span>
            </span>
            <span class="name">{c.name}</span>
            <span class="meta">{c.characters.length ? c.characters.join(' · ') : t('Not prepared: no characters yet')}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#snippet actions()}
    {#if current}<button class="primary big-btn" id="to-game" onclick={() => (host.step = 'game')}>{t('Next: choose the game')}</button>{/if}
  {/snippet}
</StepScreen>

<style>
  .clip-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 1.2rem;
  }
  .clip-card {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.4rem;
    text-align: left;
    padding: 0;
    border: none;
    background: transparent;
    min-height: 0;
  }
  .poster {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: 4px;
    background: #000 center / cover;
    outline: 3px solid transparent;
    outline-offset: 3px;
  }
  .clip-card:hover:not(:disabled) .poster,
  .clip-card:focus-visible .poster {
    outline-color: var(--line2);
  }
  .clip-card.sel .poster {
    outline-color: var(--signal);
  }
  .clip-card:disabled {
    opacity: 0.45;
  }
  .len {
    position: absolute;
    right: 0.4rem;
    bottom: 0.4rem;
    background: rgb(0 0 0 / 0.75);
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-size: 0.85rem;
  }
  .name {
    font-weight: 650;
    font-size: 1.2rem;
  }
  .meta {
    color: var(--dim);
  }
</style>
