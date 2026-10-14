// What floats above every screen: the context menu (one at a time) and the toasts. Code anywhere calls showMenu() or
// toast(); <Overlays /> (mounted once by the app) renders them.
import { flushSync } from 'svelte';

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

export interface OpenMenu {
  items: MenuItem[];
  x: number;
  y: number;
  label: string;
  /** focus goes back here when the menu closes */
  returnFocus: HTMLElement | null;
}

export type ToastKind = 'info' | 'ok' | 'warn' | 'error';
export interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
  leaving: boolean;
}

class Overlays {
  menu = $state.raw<OpenMenu | null>(null);
  toasts = $state<Toast[]>([]);
  #next = 1;

  showMenu(items: MenuItem[], x: number, y: number, label: string): void {
    const returnFocus = this.menu?.returnFocus ?? (document.activeElement as HTMLElement | null);
    this.menu = { items, x, y, label, returnFocus };
  }
  closeMenu(): void {
    const m = this.menu;
    if (!m) return;
    this.menu = null;
    m.returnFocus?.focus?.({ preventScroll: true });
  }
  toast(text: string, kind: ToastKind, ms: number): void {
    const id = this.#next++;
    this.toasts.push({ id, text, kind, leaving: false });
    setTimeout(() => {
      const t = this.toasts.find((x) => x.id === id);
      if (t) t.leaving = true;
      setTimeout(() => {
        this.toasts = this.toasts.filter((x) => x.id !== id);
      }, 300);
    }, ms);
  }
}
export const overlays = new Overlays();

/** Show a menu at viewport coordinates (kept inside the window). */
export function showMenu(items: MenuItem[], x: number, y: number, { label = 'Actions' } = {}): void {
  // in the same frame as the right-click (and before the caller's next line looks for it)
  flushSync(() => overlays.showMenu(items, x, y, label));
}
export function closeMenu(): void {
  overlays.closeMenu();
}
export const menuIsOpen = (): boolean => !!overlays.menu;

/** A short message in the corner: 'error' is announced as an alert, the others politely. */
export function toast(text: string, kind: ToastKind = 'info', ms = 3500): void {
  overlays.toast(text, kind, ms);
}
