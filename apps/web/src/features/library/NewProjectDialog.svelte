<!-- New project (dub / podcast) or a new library clip (what party games are played with): name, mode, the video file, and for dubbing whether
     to prepare it right away (separate dialogue → subtitles → speakers). -->
<script lang="ts">
  import type { Mode } from '@doblaje/core';
  import { toast } from '@doblaje/ui';
  import Modal from '@doblaje/ui/components/Modal.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { api } from '../../api.ts';
  import { requestPrepare } from '../prepare.svelte.ts';

  interface Props {
    /** a library clip instead of a project */
    template?: boolean;
    onclose: () => void;
    /** the created project, ready to open */
    oncreated: (id: string) => void;
  }
  let { template = false, onclose, oncreated }: Props = $props();

  const MODES: { mode: Mode; title: string; desc: string }[] = [
    { mode: 'pro', title: t('Pro Dub Studio'), desc: t('Timeline, rhythm band, lip-sync markers, ghost guide and translation. For practicing real dubbing.') },
    {
      mode: 'podcast',
      title: t('Podcast'),
      desc: t('Record audio and video with your camera and microphone, then trim, add chapters, clean up the voice and export.'),
    },
  ];
  const LANGS = [
    ['auto', t('Auto-detect')],
    ['spanish', 'Español'],
    ['english', 'English'],
    ['french', 'Français'],
    ['portuguese', 'Português'],
  ];

  let name = $state('');
  let mode = $state<Mode>('pro');
  let file = $state.raw<File | null>(null);
  let over = $state(false);
  let prepare = $state(true);
  let lang = $state('auto');
  let busy = $state(false);
  let progress = $state(0);
  let status = $state('');
  const prepares = $derived(template || mode === 'pro');

  function choose(f: File | null | undefined) {
    if (!f) return;
    file = f;
    if (!name) name = f.name.replace(/\.[^.]+$/, '');
  }

  async function create() {
    if (!file && mode !== 'podcast') return toast(t('Choose a video first'), 'error');
    busy = true;
    try {
      const proj = await api.createProject(name || (file ? file.name : `${t('Podcast')} ${new Date().toLocaleDateString()}`), template ? 'pro' : mode, {
        template,
      });
      if (!file) return oncreated(proj.id);
      status = t('Uploading…');
      const job = await api.uploadSource(proj.id, file, (f) => {
        progress = f * 0.4;
      });
      if (prepares && prepare) requestPrepare(proj.id, lang);
      status = t('Preparing proxy video, audio and thumbnails…');
      await api.waitJob(job, (j) => {
        progress = 0.4 + j.progress * 0.6;
        status = `${t('Preparing')}: ${j.message || ''}`;
      });
      oncreated(proj.id);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      toast(m, 'error');
      status = m;
      busy = false;
    }
  }
</script>

<Modal title={template ? t('Add a clip to the library') : t('New project')} {onclose}>
  {#if template}
    <p class="hint">{t('A clip is prepared once (dialogue, subtitles, characters). Recordings happen in projects you start from it.')}</p>
  {/if}
  <div class="col">
    <div class="field">
      <label for="np-name">{t('Name')}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="np-name" type="text" placeholder={t('Project name')} bind:value={name} autofocus />
    </div>
    {#if !template}
      <div class="lab">{t('Mode')}</div>
      <div class="modes" role="radiogroup" aria-label={t('Mode')}>
        {#each MODES as m (m.mode)}
          <button type="button" class={['mode', mode === m.mode && 'sel']} data-mode={m.mode} role="radio" aria-checked={mode === m.mode} onclick={() => (mode = m.mode)}>
            <h3>{m.title}</h3>
            <p>{m.desc}</p>
          </button>
        {/each}
      </div>
      <p class="hint">{t('Party games are played with a prepared library clip: add the video as a clip, prepare it, then choose Play at a party.')}</p>
    {/if}
    <label
      class={['drop', over && 'over']}
      id="np-drop"
      ondragover={(e) => {
        e.preventDefault();
        over = true;
      }}
      ondragleave={() => (over = false)}
      ondrop={(e) => {
        e.preventDefault();
        over = false;
        choose(e.dataTransfer?.files[0]);
      }}
    >
      {#if file}
        {file.name} · {(file.size / 1e6).toFixed(1)} MB
      {:else if mode === 'podcast' && !template}
        {t('Optional: drop an existing recording here, or leave empty and record in the next step')}
      {:else}
        {t('Drop a video here or click to choose (.mp4 .webm .mov .mkv)')}
      {/if}
      <input id="np-file" type="file" accept="video/*,.mkv,.mov,.webm,audio/*" hidden onchange={(e) => choose(e.currentTarget.files?.[0])} />
    </label>
    {#if prepares}
      <div class="row">
        <label class="row small"><input id="np-prepare" type="checkbox" bind:checked={prepare} /> {t('Prepare automatically: separate dialogue, subtitles and speakers')}</label>
        <select id="np-lang" title={t('Language of the dialogue')} bind:value={lang}>
          {#each LANGS as [v, l] (v)}<option value={v}>{l}</option>{/each}
        </select>
      </div>
    {/if}
    {#if busy}<div class="progress"><i style:width={`${progress * 100}%`}></i></div>{/if}
    <div class="small dim" role="status">{status}</div>
  </div>
  {#snippet actions()}
    <button onclick={onclose}>{t('Cancel')}</button>
    <button class="primary" id="np-create" disabled={busy} onclick={create}>{t('Create')}</button>
  {/snippet}
</Modal>

<style>
  .drop {
    display: block;
    border: 1px dashed var(--line2);
    padding: 1.3rem;
    text-align: center;
    color: var(--dim);
    cursor: pointer;
  }
  .drop.over,
  .drop:hover {
    border-color: var(--text);
    color: var(--text);
  }
</style>
