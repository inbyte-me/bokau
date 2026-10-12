// Context menus: one small, keyboard-accessible menu component plus a registry that decides, per element,
// what right-click (or the context-menu key / Shift+F10) shows. Policy (docs/design.md#context-menus):
//  - editable text and links keep the browser's own menu (copy, paste, spelling, save link);
//  - an element with relevant actions gets the app menu, listing only what applies there;
//  - everything else shows nothing (no app menu, and the browser menu is suppressed too).
import { h } from './dom.ts';
import { icon } from './icons.ts';

export interface MenuAction {
  label: string;
  icon?: string;
  /** shown on the right, e.g. 'S' or '⌥1' */
  shortcut?: string;
  disabled?: boolean;
  /** destructive actions are styled and placed last */
  danger?: boolean;
  run(): void | Promise<void>;
}
export type MenuItem = MenuAction | 'separator';

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

let open: { el: HTMLElement; close(): void } | null = null;

export function closeMenu(): void {
  open?.close();
}
export const menuIsOpen = (): boolean => !!open;

/** Show a menu at viewport coordinates (clamped inside the window). */
export function showMenu(items: MenuItem[], x: number, y: number, { label = 'Actions' } = {}): HTMLElement {
  closeMenu();
  const actions = items.filter((i): i is MenuAction => i !== 'separator');
  const buttons: HTMLButtonElement[] = [];
  const el = h('div.ctxmenu', { role: 'menu', 'aria-label': label, tabIndex: -1 });
  for (const item of items) {
    if (item === 'separator') {
      el.append(h('div.ctxsep', { role: 'separator' }));
      continue;
    }
    const b = h(
      `button.ctxitem${item.danger ? '.danger' : ''}`,
      {
        role: 'menuitem',
        disabled: !!item.disabled,
        onclick: () => {
          close();
          void item.run();
        },
      },
      item.icon ? icon(item.icon, 14) : h('span.ctxicon'),
      h('span.ctxlabel', item.label),
      item.shortcut ? h('kbd', item.shortcut) : null,
    );
    buttons.push(b);
    el.append(b);
  }
  const enabled = () => buttons.filter((b) => !b.disabled);
  const focusAt = (i: number) => {
    const list = enabled();
    if (list.length) list[(i + list.length) % list.length].focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const list = enabled();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusAt(i + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusAt(i < 0 ? -1 : i - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAt(-1);
    } else if (e.key === 'Tab') {
      close();
    }
    e.stopPropagation(); // the studio's single-key shortcuts must not fire while the menu is open
  };
  const onDown = (e: Event) => {
    if (!el.contains(e.target as Node)) close();
  };
  const previous = document.activeElement as HTMLElement | null;
  function close() {
    if (open?.el !== el) return;
    open = null;
    el.remove();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
    window.removeEventListener('wheel', close, true);
    previous?.focus?.({ preventScroll: true });
  }
  document.body.append(el);
  // clamp inside the window (menus follow the layout rules too: never off-screen)
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  el.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  window.addEventListener('wheel', close, true);
  open = { el, close };
  if (actions.length) focusAt(0);
  return el;
}

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
