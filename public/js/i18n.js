// English strings are the keys; other languages map English -> translation. Missing => English.
import { es } from './lang-es.js';

const DICTS = { es };
let lang = 'en';
const listeners = new Set();

export function detectLang() {
  try { const s = localStorage.getItem('lang'); if (s) return s; } catch {}
  return (navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
}
export function setLang(l) { lang = DICTS[l] ? l : 'en'; try { localStorage.setItem('lang', lang); } catch {} document.documentElement.lang = lang; listeners.forEach((f) => f(lang)); }
export const getLang = () => lang;
export const onLang = (f) => { listeners.add(f); return () => listeners.delete(f); };

/** t('Hello {name}', {name:'x'}) */
export function t(key, vars) {
  let s = DICTS[lang]?.[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
  return s;
}
setLang(detectLang());
