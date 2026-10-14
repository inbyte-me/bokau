// Context menus: a registry that decides, per element, what right-click (or the context-menu key / Shift+F10) shows;
// the menu itself is ContextMenu.svelte (rendered by <Overlays />). Policy (docs/design.md#context-menus):
//  - editable text and links keep the browser's own menu (copy, paste, spelling, save link);
//  - an element with relevant actions gets the app menu, listing only what applies there;
//  - everything else shows nothing (no app menu, and the browser menu is suppressed too).
import { closeMenu, type MenuItem, showMenu } from './overlays.svelte.ts';

export type { MenuAction, MenuItem } from './overlays.svelte.ts';
export { closeMenu, menuIsOpen, showMenu } from './overlays.svelte.ts';

/** Returns the menu for this target, or null when the element offers nothing. */
export type MenuProvider = (target: Element, at: { x: number; y: number }) => MenuItem[] | null;

const providers: { selector: string; provide: MenuProvider }[] = [];

/**
 * Register what right-click shows on elements matching `selector`. The innermost matching element wins; register
 * specific selectors for specific things (a clip, a cue row) rather than one big handler.
 */
export function registerMenu(selector: string, provide: MenuProvider): () => void {
  const entry = { selector, provide };
  providers.push(entry);
  return () => {
    const i = providers.indexOf(entry);
    if (i >= 0) providers.splice(i, 1);
  };
}

/** Elements where the browser's native menu is the useful one. */
export const NATIVE_MENU =
  'input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]), textarea, [contenteditable=""], [contenteditable="true"], a[href]';

function resolve(target: Element, at: { x: number; y: number }): MenuItem[] | null {
  for (let el: Element | null = target; el; el = el.parentElement) {
    for (let i = providers.length - 1; i >= 0; i--) {
      const p = providers[i];
      if (!el.matches(p.selector)) continue;
      const items = p.provide(el, at);
      if (items) return tidy(items);
    }
  }
  return null;
}
/** drop leading/trailing/double separators; destructive actions last */
function tidy(items: MenuItem[]): MenuItem[] | null {
  const safe = items.filter((i) => i === 'separator' || !i.danger);
  const danger = items.filter((i) => i !== 'separator' && i.danger);
  const all = danger.length ? [...safe, 'separator' as const, ...danger] : safe;
  const out: MenuItem[] = [];
  for (const i of all) if (!(i === 'separator' && (!out.length || out.at(-1) === 'separator'))) out.push(i);
  while (out.at(-1) === 'separator') out.pop();
  return out.length ? out : null;
}

/** Install the document-wide handlers once (the app shell does this). */
export function installContextMenus(): () => void {
  const onContext = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target) return;
    if (target.closest(NATIVE_MENU)) {
      closeMenu();
      return; // native menu
    }
    e.preventDefault();
    const items = resolve(target, { x: e.clientX, y: e.clientY });
    if (items) showMenu(items, e.clientX, e.clientY);
    else closeMenu();
  };
  // keyboard: the context-menu key or Shift+F10 opens the menu of the focused element
  const onKey = (e: KeyboardEvent) => {
    if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
    const el = document.activeElement;
    if (!el || el === document.body || el.closest(NATIVE_MENU)) return;
    const r = el.getBoundingClientRect();
    const at = { x: r.left + Math.min(24, r.width / 2), y: r.top + Math.min(r.height, 28) };
    const items = resolve(el, at);
    e.preventDefault();
    if (items) showMenu(items, at.x, at.y);
  };
  document.addEventListener('contextmenu', onContext);
  document.addEventListener('keydown', onKey);
  return () => {
    document.removeEventListener('contextmenu', onContext);
    document.removeEventListener('keydown', onKey);
  };
}
