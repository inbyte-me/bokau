<!-- Where saving stands (top bar, whenever a project is open) and a button to save now (⌘/Ctrl+S does the same). -->
<script lang="ts">
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { saveNow } from '../features/save.ts';
  import { store } from '../store.svelte.ts';

  const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const label = $derived(
    store.saveState === 'saving'
      ? t('Saving…')
      : store.saveState === 'dirty'
        ? t('Unsaved changes')
        : store.saveState === 'error'
          ? t('Save failed')
          : store.lastSavedAt
            ? t('Saved {time}', { time: clock(store.lastSavedAt) })
            : t('Saved'),
  );
</script>

<div class="save-controls">
  <button
    class={['icon', (store.saveState === 'error' || store.saveState === 'dirty') && 'attention']}
    id="save-btn"
    title={`${t('Save')} (⌘/Ctrl+S)`}
    onclick={() => saveNow()}><Icon name="save" /></button
  >
  <span class="savestate" id="save-state" role="status" aria-live="polite" data-state={store.saveState}>{label}</span>
</div>
