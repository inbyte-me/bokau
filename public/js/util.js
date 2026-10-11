// Small DOM + math helpers (no framework).

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dbToGain = (db) => 10 ** (db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-6));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** h('div.class#id', {onclick, style:{}, dataset:{}}, ...children) */
export function h(tag, props, ...children) {
  const m = /^([a-z0-9]+)((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) part[0] === '.' ? el.classList.add(part.slice(1)) : (el.id = part.slice(1));
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props) || typeof props === 'string')) { children.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k in el && k !== 'list') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function fmtClock(sec, { ms = false, frames = 0, fps = 25 } = {}) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (frames) return `${base}:${String(Math.floor((sec % 1) * fps)).padStart(2, '0')}`;
  return ms ? `${base}.${String(Math.floor((sec % 1) * 1000)).padStart(3, '0')}` : base;
}
export function fmtBytes(n) { return n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB'; }

export class Emitter {
  #h = new Map();
  on(evt, fn) { (this.#h.get(evt) || this.#h.set(evt, new Set()).get(evt)).add(fn); return () => this.off(evt, fn); }
  off(evt, fn) { this.#h.get(evt)?.delete(fn); }
  emit(evt, ...a) { for (const fn of [...(this.#h.get(evt) || [])]) { try { fn(...a); } catch (e) { console.error(`[${evt}]`, e); } } }
}

export function debounce(fn, ms) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; d.cancel = () => clearTimeout(t); return d; }

export function download(name, blobOrText, type = 'text/plain') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function toast(msg, kind = 'info', ms = 3500) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div#toasts'); document.body.append(box); }
  const el = h('div.toast.' + kind, { role: kind === 'error' ? 'alert' : 'status' }, msg);
  box.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
  return el;
}

/** Wait for a media element condition with timeout. */
export const once = (el, evt, ms = 8000) => new Promise((res, rej) => {
  const t = setTimeout(() => { el.removeEventListener(evt, f); rej(new Error('timeout waiting for ' + evt)); }, ms);
  const f = (e) => { clearTimeout(t); res(e); };
  el.addEventListener(evt, f, { once: true });
});
