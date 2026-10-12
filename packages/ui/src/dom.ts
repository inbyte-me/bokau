// Small DOM helpers (no framework). See docs/adr/0005-no-ui-framework.md.

/** 'div.row#main' -> 'div' */
type TagName<S extends string> = S extends `${infer A}#${string}` ? TagName<A> : S extends `${infer A}.${string}` ? A : S;
export type ElementFor<S extends string> = TagName<S> extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[TagName<S>] : HTMLElement;

export type Child = Node | string | number | boolean | null | undefined | Child[];

type EventProps<E extends HTMLElement> = {
  [K in keyof HTMLElementEventMap as `on${K}`]?: (e: HTMLElementEventMap[K] & { currentTarget: E; target: E }) => unknown;
};
type ElementProps<E extends HTMLElement> = {
  [K in keyof E as E[K] extends (...a: never[]) => unknown ? never : K extends `on${string}` ? never : K]?: E[K] | null | false;
};
export type Props<E extends HTMLElement = HTMLElement> = Omit<ElementProps<E>, 'style' | 'dataset'> &
  EventProps<E> & {
    style?: Partial<Record<keyof CSSStyleDeclaration, string | number>> | string;
    dataset?: Record<string, string>;
    class?: string;
    /** any other attribute (aria-*, data-*, for, list…) */
    [attr: `aria-${string}` | `data-${string}`]: string | number | boolean | null | undefined;
  };

const isProps = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !(v instanceof Node) && !Array.isArray(v);

/** h('div.class#id', {onclick, style:{}, dataset:{}}, ...children) */
export function h<S extends string>(tag: S, props?: Props<ElementFor<S>> | Child, ...children: Child[]): ElementFor<S> {
  const m = /^([a-z0-9]+)((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement(m?.[1] || 'div') as ElementFor<S>;
  for (const part of m?.[2]?.match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (!isProps(props)) {
    children.unshift(props as Child);
  } else {
    const rec = el as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'class') el.className += ` ${v}`;
      else if (k in el && k !== 'list') {
        try {
          rec[k] = v;
        } catch {
          el.setAttribute(k, String(v));
        }
      } else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children.flat(Number.POSITIVE_INFINITY as 1) as Child[]) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = <E extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<E>(sel);
export const $$ = <E extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<E>(sel)];

export function clear<E extends Element>(el: E): E {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function fmtClock(secIn: number, { ms = false, frames = 0, fps = 25 } = {}): string {
  const sec = Math.max(0, secIn || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (frames) return `${base}:${String(Math.floor((sec % 1) * fps)).padStart(2, '0')}`;
  return ms ? `${base}.${String(Math.floor((sec % 1) * 1000)).padStart(3, '0')}` : base;
}
export function fmtBytes(n: number): string {
  return n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`;
}

export interface Debounced<A extends unknown[]> {
  (...a: A): void;
  flush(...a: A): void;
  cancel(): void;
}
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): Debounced<A> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = ((...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  }) as Debounced<A>;
  d.flush = (...a: A) => {
    clearTimeout(t);
    fn(...a);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function download(name: string, blobOrText: Blob | string, type = 'text/plain'): void {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export type ToastKind = 'info' | 'ok' | 'warn' | 'error';
export function toast(msg: string, kind: ToastKind = 'info', ms = 3500): HTMLElement {
  let box = document.getElementById('toasts');
  if (!box) {
    box = h('div#toasts');
    document.body.append(box);
  }
  const el = h(`div.toast.${kind}`, { role: kind === 'error' ? 'alert' : 'status' }, msg);
  box.append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, ms);
  return el;
}

/** Wait for an element event, with timeout. */
export const once = (el: EventTarget, evt: string, ms = 8000): Promise<Event> =>
  new Promise((res, rej) => {
    const f = (e: Event) => {
      clearTimeout(t);
      res(e);
    };
    const t = setTimeout(() => {
      el.removeEventListener(evt, f);
      rej(new Error(`timeout waiting for ${evt}`));
    }, ms);
    el.addEventListener(evt, f, { once: true });
  });
