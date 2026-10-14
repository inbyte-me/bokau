<!-- The timeline band: tools, marks, lane headers row-aligned with the canvas (drawn and edited by Timeline), and the
     time scrollbar. Lanes scroll vertically together; time scrolls with its own scrollbar. -->
<script lang="ts">
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { untrack } from 'svelte';
  import { app } from '../../../app.svelte.ts';
  import { store } from '../../../store.svelte.ts';
  import { lanes, Timeline } from '../../timeline.ts';
  import { getStudio } from '../studio.svelte.ts';
  import LaneHead from './LaneHead.svelte';

  const studio = getStudio();
  let canvas = $state<HTMLCanvasElement | null>(null);
  let wrap = $state<HTMLElement | null>(null);
  let sbar = $state<HTMLElement | null>(null);
  let thumb = $state<HTMLElement | null>(null);

  // the project as the headers show it: a fresh copy when lanes or their settings change
  const project = $derived(store.read(['tracks', 'speakers', 'media', 'levels', 'meta'], (p) => structuredClone(p), null));
  const rows = $derived(project ? lanes(project) : []);
  const marks = $derived(store.read(['markers'], (p) => p.markers.map((m) => ({ ...m })), []));
  const selectedTrack = $derived(app.sel.trackId ?? project?.tracks[0]?.id ?? null);

  /** The canvas engine, once its elements exist (built untracked: it reads the project while setting up). */
  function engine(_el: HTMLElement) {
    if (!canvas || !wrap || !sbar || !thumb) return;
    const els = { canvas, wrap, sbar, sbarThumb: thumb };
    const tl = untrack(() => new Timeline(els));
    studio.tl = tl;
    return () => {
      tl.destroy();
      studio.tl = null;
    };
  }
  // lanes added or removed: the canvas follows the headers' heights
  $effect(() => {
    void rows.length;
    studio.tl?.rebuild();
  });
  const fmtMark = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
</script>

<div class="timeline" {@attach engine}>
  <div class="tl-toolbar">
    <button class="icon" id="zoom-out" title={t('Zoom out (-)')} onclick={() => studio.tl?.zoom(0.7)}><Icon name="minus" /></button>
    <button class="icon" id="zoom-in" title={t('Zoom in (+)')} onclick={() => studio.tl?.zoom(1.4)}><Icon name="plus" /></button>
    <button class="icon" id="zoom-fit" title={t('Fit to window')} onclick={() => studio.tl?.fit()}><Icon name="fit" /></button>
    <div class="sep"></div>
    <button id="add-track" title={t('Add a voice track (another character or take lane)')} onclick={() => studio.tl?.addTrack()}><Icon name="plus" />{t('Voice track')}</button>
    <button id="split-btn" title={t('Split the selected passage, cue or clip at the playhead (S)')} onclick={() => studio.tl?.splitAtPlayhead()}
      ><Icon name="split" />{t('Split')}</button
    >
    <button class="icon" id="del-btn" title={t('Delete selected clip / cue (Del)')} onclick={() => studio.tl?.deleteSelected()}><Icon name="trash" /></button>
    <div class="sep"></div>
    <button id="loop-btn" title={t('Loop the selected cue or the dragged range (L)')} onclick={() => studio.tl?.loopFromSelection()}><Icon name="loop" />{t('Loop')}</button>
    <div class="row" id="marks-bar" title={t('Marks: ⌘/Ctrl+number sets, ⌥/Option+number jumps (Shift+number also sets)')}>
      <span class="small dim"><Icon name="flag" /></span>
      {#each marks as m (m.n)}
        <button class="chip mark" data-n={m.n} title={t('Jump to mark {n} (⌥{n}) — right-click to delete', { n: m.n })} onclick={() => studio.jumpMark(m.n)}
          >{m.n} · {fmtMark(m.t)}</button
        >
      {:else}
        <span class="small faint">{t('⌘/Ctrl+1…9 set a mark · ⌥/Option+1…9 jump')}</span>
      {/each}
    </div>
    <span class="hint tl-hint" title={t('Drag the ruler to scrub · Shift+drag to set a punch/loop range · Ctrl+wheel to zoom')}
      >{t('Drag the ruler to scrub · Shift+drag to set a punch/loop range · Ctrl+wheel to zoom')}</span
    >
  </div>
  <div class="tl-scroll">
    <div class="tl-inner">
      <div class="tl-heads">
        {#if project}
          {#each rows as row (row.k + (row.id ?? ''))}
            <LaneHead {row} {project} tl={studio.tl} selected={row.k === 'track' && row.id === selectedTrack} />
          {/each}
        {/if}
      </div>
      <div class="tl-canvas-wrap" bind:this={wrap}><canvas class="tl" id="timeline-canvas" bind:this={canvas}></canvas></div>
    </div>
  </div>
  <div class="tl-scrollbar" bind:this={sbar}><i bind:this={thumb}></i></div>
</div>
