<!-- A party round from the library: watch it again, play another round with the same clip, or open it in the
     studio (one track per player, every take kept). -->
<script lang="ts">
  import type { Project } from '@doblaje/core';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { app } from '../../app.svelte.ts';
  import { go } from '../../router.svelte.ts';
  import { screenBar } from '../../shell/bar.svelte.ts';
  import { transport } from '../../transport.svelte.ts';
  import StageView from '../studio/StageView.svelte';

  interface Props {
    project: Project;
  }
  let { project }: Props = $props();
  const p = untrack(() => project);
  let ready = $state(false);
  const players = p.tracks.filter((tr) => tr.clips.length).map((tr) => ({ name: tr.name, color: tr.color, takes: tr.clips.length }));
  const takes = players.reduce((n, x) => n + x.takes, 0);

  function load(v: HTMLVideoElement) {
    untrack(() => app.engine.load(p, v)).then(() => (ready = true));
    return () => {};
  }
  function play() {
    if (app.engine.playing) app.engine.pause();
    else void app.engine.resume().then(() => app.engine.play(transport.time >= app.engine.duration - 0.1 ? 0 : transport.time));
  }
  onMount(() => screenBar.show(bar));
  onDestroy(() => app.engine.stop());
</script>

{#snippet bar()}
  <span class="small dim">{p.name}</span>
{/snippet}

<div class="round" id="party-round">
  <div class="stage-box"><StageView projectId={p.id} banner={p.party.mode !== 'blind'} onvideo={load} /></div>
  <aside class="side">
    <p class="eyebrow">{t('Party round')}</p>
    <h1>{p.name}</h1>
    <ul class="players">
      {#each players as pl (pl.name)}
        <li style:--c={pl.color}><span class="name">{pl.name}</span><span class="dim">{t('{n} takes', { n: pl.takes })}</span></li>
      {:else}
        <li class="dim">{t('Nobody recorded in this round.')}</li>
      {/each}
    </ul>
    <p class="dim">{t('{n} takes in total', { n: takes })}</p>
    <div class="actions">
      <button class="primary big-btn" id="round-play" disabled={!ready} onclick={play}
        ><Icon name={transport.playing ? 'pause' : 'play'} />{transport.playing ? t('Pause') : t('Watch')}</button
      >
      {#if p.sourceTemplateId}
        <button class="big-btn" id="round-again" onclick={() => go(`/party?clip=${p.sourceTemplateId}`)}><Icon name="tv" />{t('Play another round')}</button>
      {/if}
      <button class="ghost" id="round-studio" onclick={() => go(`/p/${p.id}/studio`)}>{t('Open in the studio')}</button>
    </div>
  </aside>
</div>

<style>
  .round {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(280px, 28vw, 420px);
    gap: 1.5rem;
    padding: 1.5rem 2rem;
    overflow-x: hidden;
    overflow-y: auto; /* screen */
  }
  .stage-box {
    min-height: 240px;
    display: flex;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .eyebrow {
    margin: 0;
    color: var(--faint);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  h1 {
    margin: 0;
    font-family: var(--display);
    font-size: 2.2rem;
  }
  .players {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .players li {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.35rem 0 0.35rem 0.8rem;
    border-left: 4px solid var(--c);
  }
  .name {
    font-weight: 600;
  }
  .dim {
    color: var(--dim);
    margin: 0;
  }
  .actions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.6rem;
    margin-top: auto;
  }
  @media (max-width: 999px) {
    .round {
      grid-template-columns: 1fr;
    }
  }
</style>
