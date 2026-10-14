// Small formatting and browser helpers shared by the apps.

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
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
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
