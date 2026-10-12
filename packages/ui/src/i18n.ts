// English strings are the keys; other languages map English -> translation. Missing => English.
import { es } from './lang-es.ts';

export type UiLang = 'en' | 'es';
const DICTS: Record<string, Record<string, string>> = { es };
let lang: UiLang = 'en';
const listeners = new Set<(l: UiLang) => void>();

export function detectLang(): UiLang {
  try {
    const s = localStorage.getItem('lang');
    if (s === 'en' || s === 'es') return s;
  } catch {}
  return (navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
}
export function setLang(l: string): void {
  lang = l === 'es' ? 'es' : 'en';
  try {
    localStorage.setItem('lang', lang);
  } catch {}
  document.documentElement.lang = lang;
  for (const f of listeners) f(lang);
}
export const getLang = (): UiLang => lang;
export const onLang = (f: (l: UiLang) => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

/** t('Hello {name}', {name:'x'}) */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = DICTS[lang]?.[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
  return s;
}
setLang(detectLang());
