// Saving you can see and control. Projects autosave 0.7 s after each edit; on top of that the user can save at any
// moment (the save button in the top bar, File → Save, ⌘/Ctrl+S). The top bar shows where things stand
// (shell/SaveControls.svelte).
import { t, toast } from '@doblaje/ui';
import { app } from '../app.svelte.ts';

/** Save now, with feedback. Returns whether the server confirmed. */
export async function saveNow(): Promise<boolean> {
  if (!app.store.current) return false;
  const ok = await app.store.save();
  if (!ok) toast(t('Could not save. Your changes are still here; try again.'), 'error', 5000);
  return ok;
}

// ---------------------------------------------------------------- File menu
export interface FileActions {
  export?: () => void;
}
let current: FileActions = {};
/** Screens register what File offers for them (e.g. Export); returns the unregister function. */
export function setFileActions(a: FileActions): () => void {
  current = a;
  return () => {
    if (current === a) current = {};
  };
}
/** What File offers on the current screen. */
export const fileActions = (): FileActions => current;

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
    else if (cmd === 'export') current.export?.();
    else if (cmd === 'new') go('/new');
    else if (cmd === 'open' || cmd === 'close') go('/');
    else if (cmd === 'ai-changed') window.dispatchEvent(new Event('doblaje:ai-changed'));
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
