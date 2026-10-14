<!-- The studio's part of the top bar: the project's name, undo/redo, export (or, for a library clip, start a project). -->
<script lang="ts">
  import { showMenu } from '@doblaje/ui';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { go } from '../../router.svelte.ts';
  import { store } from '../../store.svelte.ts';
  import { exportDialog } from '../export/export.svelte.ts';
  import { deriveAndOpen } from '../library/derive.ts';
  import type { StudioState } from './studio.svelte.ts';

  // rendered inside the top bar, outside the studio's component tree: the studio comes as a prop, not from context
  interface Props {
    studio: StudioState;
  }
  let { studio }: Props = $props();
  const name = $derived(store.read(['meta'], (p) => p.name, ''));
  const template = $derived(store.read(['meta'], (p) => p.template, false));
  const canUndo = $derived(store.read(['all'], () => store.undoStack.length > 0, false));
  const canRedo = $derived(store.read(['all'], () => store.redoStack.length > 0, false));

  function rename(e: Event & { currentTarget: HTMLInputElement }) {
    const v = e.currentTarget.value.trim();
    if (v)
      store.commit(
        'Rename project',
        (p) => {
          p.name = v;
        },
        ['meta'],
      );
  }
  function startProject(e: MouseEvent & { currentTarget: HTMLButtonElement }) {
    const r = e.currentTarget.getBoundingClientRect();
    const id = store.project.id;
    const from = (mode: 'pro' | 'podcast') => () => void store.save().then(() => deriveAndOpen(id, mode, go));
    showMenu(
      [
        { label: t('New dubbing project from this clip'), icon: 'mic', run: from('pro') },
        { label: t('Play at a party'), icon: 'tv', run: () => void store.save().then(() => go(`/party?clip=${id}`)) },
        { label: t('New podcast project from this clip'), icon: 'wave', run: from('podcast') },
      ],
      r.left,
      r.bottom + 2,
    );
  }
</script>

<input class="title" id="proj-title" type="text" value={name} onchange={rename} aria-label={t('Project name')} />
<button class="icon" id="undo" title={t('Undo (Ctrl/⌘+Z)')} disabled={!canUndo} onclick={() => studio.undo()}><Icon name="undo" /></button>
<button class="icon" id="redo" title={t('Redo')} disabled={!canRedo} onclick={() => studio.redo()}><Icon name="redo" /></button>
{#if template}
  <span class="chip clip-badge" id="clip-badge" title={t('A library clip: prepare dialogue, subtitles and characters here; record in projects started from it.')}
    >{t('Library clip')}</span
  >
  <button class="primary" id="use-clip" onclick={startProject}><Icon name="plus" />{t('Start a project')}</button>
{:else}
  <button class="primary" id="export-btn" onclick={() => exportDialog()}><Icon name="export" />{t('Export')}</button>
{/if}
<button class="icon" id="help-btn" title={t('Keyboard shortcuts (?)')} onclick={() => (studio.showHelp = true)}><Icon name="keys" /></button>
