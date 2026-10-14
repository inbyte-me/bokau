<!-- Script tab: get the dialogue text (import subtitles, auto-transcribe, empty speech slots), export it, and edit
     every line. -->
<script lang="ts">
  import { type Cue, errorMessage, newCue, segmentsToCues, toJson, toSrt } from '@doblaje/core';
  import { STT_MODELS, transcribeProject } from '@doblaje/speech';
  import { download, toast } from '@doblaje/ui';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { onMount } from 'svelte';
  import { api } from '../../../api.ts';
  import { app } from '../../../app.svelte.ts';
  import { store } from '../../../store.svelte.ts';
  import { transport } from '../../../transport.svelte.ts';
  import CueRow from './CueRow.svelte';

  type CueInput = Pick<Cue, 'start' | 'end' | 'text'> & Partial<Pick<Cue, 'character' | 'direction'>>;
  const LANGS = [
    ['auto', t('Auto-detect')],
    ['english', 'English'],
    ['spanish', 'Español'],
    ['french', 'Français'],
    ['portuguese', 'Português'],
    ['german', 'Deutsch'],
    ['italian', 'Italiano'],
  ];

  const cues = $derived(store.read(['cues'], (p) => p.cues.map((c) => ({ ...c })), []));
  const activeId = $derived(cues.find((c) => transport.time >= c.start && transport.time < c.end)?.id ?? null);
  let model = $state('Xenova/whisper-base');
  let lang = $state('auto');
  let status = $state('');
  let busy = $state(false);
  let list = $state<HTMLElement | null>(null);

  function setCues(next: CueInput[], replace = true, label = 'Set cues') {
    store.commit(
      label,
      (p) => {
        const mapped = next.map((c) => newCue({ start: c.start, end: c.end, text: c.text, character: c.character || '', direction: c.direction || '' }));
        p.cues = replace ? mapped : [...p.cues, ...mapped].sort((a, b) => a.start - b.start);
      },
      ['cues'],
    );
  }
  async function importSubs(input: HTMLInputElement) {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const { cues: got } = await api.raw<{ cues: CueInput[] }>(`/api/projects/${store.project.id}/import-subs`, f);
      const n = store.project.cues.length;
      const replace = !n || confirm(t('Replace the {n} existing cues with the {m} imported ones? (Cancel = append)', { n, m: got.length }));
      setCues(got, replace, 'Import subtitles');
      toast(t('{n} cues imported', { n: got.length }), 'ok');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
  async function transcribe() {
    busy = true;
    status = t('Starting speech recognition…');
    try {
      const r = await transcribeProject(store.project, {
        model,
        language: lang,
        onProgress: (p) => {
          status = p.type === 'progress' ? `${t('Downloading model')} ${Math.round(p.pct * 100)}%` : t('Transcribing…');
        },
      });
      if (!r.cues.length) {
        status = t('No speech found.');
        return;
      }
      setCues(r.cues, !store.project.cues.length || confirm(t('Replace existing cues?')), 'Transcribe');
      status = t('{n} cues from speech recognition.', { n: r.cues.length });
    } catch (e) {
      status = errorMessage(e);
      toast(errorMessage(e), 'error');
    } finally {
      busy = false;
    }
  }
  async function speechSlots() {
    const { segments } = await api.speechSegments(store.project.id);
    if (!segments.length) {
      toast(t('No speech detected'), 'error');
      return;
    }
    setCues(segmentsToCues(segments), !store.project.cues.length || confirm(t('Replace existing cues with empty speech slots?')), 'Speech slots');
    toast(t('{n} empty cue slots created — fill them in or use the AI tab', { n: segments.length }), 'ok');
  }
  function addAtPlayhead() {
    const s = app.engine.time;
    const c = newCue({ start: s, end: Math.min(app.engine.duration, s + 2), text: t('New line') });
    store.commit(
      'Add cue',
      (p) => {
        p.cues.push(c);
        p.cues.sort((a, b) => a.start - b.start);
      },
      ['cues'],
    );
    app.select({ cueId: c.id });
  }
  function clearAll() {
    if (store.project.cues.length && confirm(t('Delete all cues?')))
      store.commit(
        'Clear cues',
        (p) => {
          p.cues = [];
        },
        ['cues'],
      );
  }
  const exportSrt = () => download(`${store.project.name}.srt`, toSrt(store.project.cues));
  const exportJson = () =>
    download(
      `${store.project.name}.json`,
      toJson(store.project.cues, { project: store.project.name, duration: store.project.media?.duration || 0 }),
      'application/json',
    );

  // the timeline's "edit this cue" focuses its text here
  onMount(() => app.on('focus-cue', (id: string) => setTimeout(() => list?.querySelector<HTMLTextAreaElement>(`.cue[data-id="${id}"] textarea`)?.focus(), 50)));
</script>

<div class="box">
  <h4>{t('Get dialogue text')}</h4>
  <div class="row">
    <label class="button" id="sub-import"
      ><Icon name="file" />{t('Import .srt / .vtt')}
      <input type="file" accept=".srt,.vtt,text/plain" hidden id="sub-file" onchange={(e) => importSubs(e.currentTarget)} /></label
    >
    <button id="cue-add" onclick={addAtPlayhead}>{t('Cue at playhead')}</button>
  </div>
  <div class="row">
    <select id="stt-model" bind:value={model}>
      {#each STT_MODELS as m (m.id)}<option value={m.id}>{t(m.label)}</option>{/each}
    </select>
    <select id="stt-lang" bind:value={lang}>
      {#each LANGS as [v, l] (v)}<option value={v}>{l}</option>{/each}
    </select>
  </div>
  <div class="row">
    <button class="primary" id="stt-go" disabled={busy} onclick={transcribe}>{t('Auto-transcribe')}</button>
    <button id="vad-go" title={t('Create empty cue slots where someone is talking')} onclick={speechSlots}>{t('Speech slots')}</button>
  </div>
  <div class="hint" id="stt-status" role="status">{status}</div>
</div>
<div class="row">
  <button id="srt-export" onclick={exportSrt}><Icon name="download" />.srt</button>
  <button id="json-export" onclick={exportJson}><Icon name="download" />.json</button>
  <div class="spacer"></div>
  <button class="ghost" onclick={clearAll}><Icon name="trash" />{t('Clear')}</button>
</div>
<div class="cue-list" id="cue-list" bind:this={list}>
  {#each cues as c (c.id)}
    <CueRow cue={c} selected={app.sel.cueId === c.id} active={activeId === c.id} follow={transport.playing} />
  {:else}
    <div class="hint">{t('No cues yet. Import subtitles, auto-transcribe, or double-click the cue lane in the timeline.')}</div>
  {/each}
</div>
