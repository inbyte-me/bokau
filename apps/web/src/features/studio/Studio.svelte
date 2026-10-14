<!-- The dubbing studio: picture and rhythm band, the side panels (script → voices → marks → record → mix → AI),
     the transport and the timeline. Behaviour lives in StudioState (studio.svelte.ts); this is the layout. -->
<script lang="ts">
  import { type Cue, errorMessage, type Project } from '@doblaje/core';
  import { t } from '@doblaje/ui/i18n';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { app } from '../../app.svelte.ts';
  import { screenBar } from '../../shell/bar.svelte.ts';
  import { store } from '../../store.svelte.ts';
  import { transport } from '../../transport.svelte.ts';
  import { toggleTv } from '../../tv.ts';
  import { RhythmBand } from '../band.ts';
  import { exportDialog } from '../export/export.svelte.ts';
  import { registerStudioMenus } from '../menus.ts';
  import { prepare, takePrepareRequest } from '../prepare.svelte.ts';
  import { setFileActions } from '../save.ts';
  import AiPanel from './panels/AiPanel.svelte';
  import MarksPanel from './panels/MarksPanel.svelte';
  import MixPanel from './panels/MixPanel.svelte';
  import RecordPanel from './panels/RecordPanel.svelte';
  import ScriptPanel from './panels/ScriptPanel.svelte';
  import VoicesPanel from './panels/VoicesPanel.svelte';
  import ShortcutsDialog from './ShortcutsDialog.svelte';
  import StageView from './StageView.svelte';
  import StudioBar from './StudioBar.svelte';
  import { StudioState, setStudio, type TabId } from './studio.svelte.ts';
  import Transport from './Transport.svelte';
  import TimelineView from './timeline/TimelineView.svelte';

  interface Props {
    project: Project;
  }
  let { project }: Props = $props();

  const studio = new StudioState();
  setStudio(studio);

  let loading = $state<string | null>(t('Loading audio…'));
  const template = $derived(store.read(['meta'], (p) => p.template, false));

  const TABS = $derived<[TabId, string][]>([
    ['cues', t('Script')],
    ['voices', t('Voices')],
    ['marks', t('Marks')],
    ...(template ? [] : [['record', t('Record')] as [TabId, string]]),
    ['mix', t('Mix')],
    ['ai', t('AI')],
  ]);

  // first tab: the one in use last time, or Voices when the clip is being prepared, or Script when it has subtitles
  // a Studio lives for one project (the route remounts it for another): read the project once
  const initial = untrack(() => project);
  const prepareLang = takePrepareRequest(initial.id);
  {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem('tab');
    } catch {}
    const ok = (id: string | null): id is TabId =>
      !!id && ['cues', 'voices', 'marks', 'record', 'mix', 'ai'].includes(id) && !(id === 'record' && initial.template);
    studio.tab = prepareLang ? 'voices' : ok(saved) ? saved : initial.cues.length ? 'cues' : 'voices';
  }

  // the timeline draws the recording state (red lane, live take)
  $effect(() => {
    void transport.recording;
    studio.tl?.invalidate();
  });

  // Attachments re-run when reactive state they read changes. The canvas engines and menus read the selection and
  // the project while setting up, so they are created untracked: built once, torn down only with the element.
  function band(canvas: HTMLCanvasElement) {
    const b = untrack(() => new RhythmBand(canvas));
    studio.band = b;
    return () => {
      b.destroy();
      studio.band = null;
    };
  }

  const offs: (() => void)[] = [];
  onMount(() => {
    offs.push(
      screenBar.show(bar),
      setFileActions(project.template ? {} : { export: () => exportDialog() }),
      app.engine.on('ended', () => studio.onEnded()),
      app.on('record-cue', (cue: Cue, loop?: boolean) => studio.recordCue(cue, loop)),
      app.on('jump-mark', (n: number) => void studio.jumpMark(n)),
      app.on('show-tab', (id: TabId) => studio.setTab(id)),
      app.on('delete-mark', (n: number) => studio.deleteMark(n)),
    );
  });
  onDestroy(() => {
    for (const off of offs) off();
    if (app.session.state !== 'idle') app.session.stop();
    app.engine.stop();
    void store.flush();
    app.mic.close();
  });

  /** Load the project's audio into the engine with this video; then the timeline and menus can start. */
  function load(v: HTMLVideoElement) {
    let alive = true;
    untrack(() => app.engine.load(initial, v))
      .then(() => {
        if (!alive) return;
        loading = null;
        if (prepareLang) void prepare.run(['separate', 'subtitles', 'speakers'], prepareLang);
      })
      .catch((e: unknown) => {
        loading = errorMessage(e);
      });
    return () => {
      alive = false;
    };
  }

  // menus need the timeline; registered once it exists
  function menus(_el: HTMLElement) {
    const tl = studio.tl; // the only dependency: re-register when the timeline is (re)created
    if (!tl) return;
    return untrack(() =>
      registerStudioMenus({
        tl,
        record: (target) => void studio.toggleRecord(target),
        setMark: (n, tm) => studio.setMark(n, tm),
        jumpMark: (n) => void studio.jumpMark(n),
        deleteMark: (n) => studio.deleteMark(n),
        toggleBanner: () => studio.toggleBanner(),
        toggleTv: () => toggleTv(),
      }),
    );
  }
</script>

<svelte:window onkeydown={(e) => studio.keydown(e)} onkeyup={(e) => studio.keyup(e)} />

{#snippet bar()}
  <StudioBar {studio} />
{/snippet}

{#if loading}<div class="hint" id="loading">{loading}</div>{/if}
<div class={['studio', transport.recording === 'recording' && 'recording']} {@attach menus}>
  <div class="stage-wrap">
    <StageView projectId={project.id} banner={studio.banner} onvideo={load} />
    <canvas class="band" id="band" {@attach band}></canvas>
  </div>
  <div class="side">
    <div class="tabs" role="tablist">
      {#each TABS as [id, label] (id)}
        <button class={['tab', studio.tab === id && 'sel']} data-tab={id} id={`tab-${id}`} role="tab" aria-selected={studio.tab === id} onclick={() => studio.setTab(id)}
          >{label}</button
        >
      {/each}
    </div>
    <div class="panel" id="panel">
      {#if !loading && studio.band}
        {#if studio.tab === 'cues'}<ScriptPanel />
        {:else if studio.tab === 'voices'}<VoicesPanel />
        {:else if studio.tab === 'marks'}<MarksPanel />
        {:else if studio.tab === 'record'}<RecordPanel />
        {:else if studio.tab === 'mix'}<MixPanel />
        {:else}<AiPanel />
        {/if}
      {/if}
    </div>
  </div>
  <Transport />
  {#if !loading}
    <TimelineView />
  {:else}
    <div class="timeline"></div>
  {/if}
</div>

{#if studio.showHelp}<ShortcutsDialog onclose={() => (studio.showHelp = false)} />{/if}
