<!-- File: New, Open, Save, Export (when the screen offers it), Close. Same commands as the desktop app's File menu. -->
<script lang="ts">
  import { showMenu } from '@doblaje/ui';
  import { t } from '@doblaje/ui/i18n';
  import { fileActions, saveNow } from '../features/save.ts';
  import { go } from '../router.svelte.ts';
  import { store } from '../store.svelte.ts';

  function open(e: MouseEvent & { currentTarget: HTMLButtonElement }) {
    const r = e.currentTarget.getBoundingClientRect();
    const project = !!store.current;
    const exp = fileActions().export;
    showMenu(
      [
        { label: t('New project…'), icon: 'plus', run: () => go('/new') },
        { label: t('Open…'), icon: 'file', run: () => go('/') },
        'separator',
        { label: t('Save'), icon: 'save', shortcut: '⌘S', disabled: !project, run: () => void saveNow() },
        ...(exp ? [{ label: t('Export…'), icon: 'export', run: exp }] : []),
        'separator',
        { label: t('Close project'), icon: 'close', disabled: !project, run: () => go('/') },
      ],
      r.left,
      r.bottom + 2,
      { label: t('File') },
    );
  }
</script>

<button class="ghost" id="file-menu" aria-haspopup="menu" onclick={open}>{t('File')}</button>
