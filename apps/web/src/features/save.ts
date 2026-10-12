// Saving you can see and control. Projects autosave 0.7 s after each edit; on top of that the user can save at any
// moment (save button, File → Save, ⌘/Ctrl+S), and the top bar always says where things stand.
import { h, icon, showMenu, t, toast } from '@doblaje/ui';
import { app } from '../app.ts';
import type { SaveState } from '../store.ts';

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Save now, with feedback. Returns whether the server confirmed. */
export async function saveNow(): Promise<boolean> {
  if (!app.store.current) return false;
  const ok = await app.store.save();
  if (!ok) toast(t('Could not save. Your changes are still here; try again.'), 'error', 5000);
  return ok;
}

/** Status text + save button for the top bar of any open project. */
export function saveControls(): { el: HTMLElement; destroy(): void } {
  const status = h('span.savestate#save-state', { role: 'status', 'aria-live': 'polite' });
  const btn = h('button.icon#save-btn', { title: `${t('Save')} (⌘/Ctrl+S)`, onclick: () => void saveNow() }, icon('save'));
  const render = (s: SaveState = app.store.saveState) => {
    const last = app.store.lastSavedAt;
    status.textContent =
      s === 'saving'
        ? t('Saving…')
        : s === 'dirty'
          ? t('Unsaved changes')
          : s === 'error'
            ? t('Save failed')
            : last
              ? t('Saved {time}', { time: clock(last) })
              : t('Saved');
    status.dataset.state = s;
    btn.classList.toggle('attention', s === 'error' || s === 'dirty');
  };
  const off = app.store.on('save-state', render);
  render();
  return { el: h('div.save-controls', btn, status), destroy: off };
}

// ---------------------------------------------------------------- File menu
export interface FileActions {
  export?: () => void;
}
let fileActions: FileActions = {};
/** Screens register what File offers for them (e.g. Export); returns the unregister function. */
export function setFileActions(a: FileActions): () => void {
  fileActions = a;
  return () => {
    if (fileActions === a) fileActions = {};
  };
}

export function fileMenuButton(go: (path: string) => void): HTMLElement {
  const btn: HTMLButtonElement = h(
    'button.ghost#file-menu',
    {
      'aria-haspopup': 'menu',
      onclick: () => {
        const r = btn.getBoundingClientRect();
        const open = !!app.store.current;
        showMenu(
          [
            { label: t('New project…'), icon: 'plus', run: () => go('/new') },
            { label: t('Open…'), icon: 'file', run: () => go('/') },
            'separator',
            { label: t('Save'), icon: 'save', shortcut: '⌘S', disabled: !open, run: () => void saveNow() },
            ...(fileActions.export ? [{ label: t('Export…'), icon: 'export', run: fileActions.export }] : []),
            'separator',
            { label: t('Close project'), icon: 'close', disabled: !open, run: () => go('/') },
          ],
          r.left,
          r.bottom + 2,
          { label: t('File') },
        );
      },
    },
    t('File'),
  );
  return btn;
}

/** ⌘/Ctrl+S everywhere (also while typing), and the desktop app's native File menu. Installed once by the shell. */
export function installSaveShortcuts(go: (path: string) => void): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault(); // not the browser's "Save page as…"
        e.stopPropagation();
        void saveNow();
      }
    },
    true,
  );
  window.doblajeDesktop?.onMenuCommand?.((cmd) => {
    if (cmd === 'save') void saveNow();
    else if (cmd === 'export') fileActions.export?.();
    else if (cmd === 'new') go('/new');
    else if (cmd === 'open' || cmd === 'close') go('/');
  });
  // leaving with changes the server has not confirmed: ask first (autosave usually got there already)
  window.addEventListener('beforeunload', (e) => {
    const s = app.store.current ? app.store.saveState : 'saved';
    if (s === 'saved') return;
    void app.store.flush();
    e.preventDefault();
  });
}

declare global {
  interface Window {
    /** present only inside the desktop app (apps/desktop/src/preload.ts) */
    doblajeDesktop?: { platform: string; onMenuCommand?: (cb: (cmd: string) => void) => void };
  }
}
