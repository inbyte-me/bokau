// Heuristic syllable counting + word timing for en / es / fr (good enough for lip-sync fitting).

export type Lang = 'en' | 'es' | 'fr';

export function detectLang(text: string): Lang {
  const t = ` ${text.toLowerCase()} `;
  const score = (words: string[]) => words.reduce((n, w) => n + (t.includes(` ${w} `) ? 1 : 0), 0);
  const es =
    score(['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'un', 'una', 'es', 'por', 'con', 'no', 'para', 'mi', 'tu', 'yo', 'qué', 'está', 'pero']) +
    (/[¿¡ñ]/.test(t) ? 2 : 0);
  const fr =
    score(['le', 'la', 'les', 'des', 'est', 'une', 'un', 'et', 'je', 'tu', 'pas', 'pour', 'que', 'vous', 'nous', 'dans', 'ce', 'mais']) +
    (/[çœ]/.test(t) ? 2 : 0);
  const en = score(['the', 'and', 'to', 'of', 'is', 'you', 'it', 'that', 'in', 'my', 'we', 'i', 'this', 'are', 'for', 'not', 'what', 'with']);
  if (es > en && es >= fr) return 'es';
  if (fr > en && fr > es) return 'fr';
  return 'en';
}

const clean = (w: string) => w.toLowerCase().replace(/[^a-záéíóúüñàèìòùâêîôûëïöçœ]/g, '');

function countEs(w: string): number {
  const groups = w.match(/[aeiouáéíóúü]+/g) || [];
  let n = 0;
  for (const g of groups) {
    let c = 1;
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1];
      const b = g[i];
      const aStrong = 'aeoáéó'.includes(a);
      const bStrong = 'aeoáéó'.includes(b);
      if ((aStrong && bStrong) || 'íú'.includes(a) || 'íú'.includes(b)) c++;
    }
    n += c;
  }
  return Math.max(1, n);
}
const EN_EXC: Record<string, number> = {
  seriously: 4,
  create: 2,
  created: 3,
  business: 2,
  being: 2,
  idea: 3,
  area: 3,
  video: 3,
  radio: 3,
  poem: 2,
  quiet: 2,
  science: 2,
  real: 1,
  really: 2,
  every: 2,
  different: 3,
  evening: 2,
  family: 3,
  chocolate: 3,
  comfortable: 3,
  favorite: 3,
};
function countEn(word: string): number {
  const w = word.replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  if (EN_EXC[w] != null) return EN_EXC[w];
  const s = w.replace(/(?:[^laeiouytdsxzcgh]es|[^td]ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const m = s.match(/[aeiouy]+/g);
  return Math.max(1, m ? m.length : 1);
}
function countFr(w: string): number {
  const s = w.replace(/(?:es|e|ent)$/, (m) => (w.length > 3 ? '' : m));
  const m = s.match(/[aeiouyàèéêëîïôûùœ]+/g);
  return Math.max(1, m ? m.length : 1);
}

export function countSyllables(word: string, lang: string = 'en'): number {
  const w = clean(word);
  if (!w) return 0;
  return lang === 'es' ? countEs(w) : lang === 'fr' ? countFr(w) : countEn(w);
}
export function countText(text: string, lang?: string): number {
  const l = lang || detectLang(text);
  return text.split(/\s+/).reduce((n, w) => n + countSyllables(w, l), 0);
}

/** indices of bilabial letters (m b p; v in Spanish) where the lips close */
export function bilabialIdx(word: string, lang: string = 'en'): number[] {
  const set = lang === 'es' ? 'mbpv' : 'mbp';
  const out: number[] = [];
  for (let i = 0; i < word.length; i++) if (set.includes(word[i].toLowerCase())) out.push(i);
  return out;
}
export const isBilabialWord = (w: string, lang?: string) => bilabialIdx(w, lang).length > 0;

export interface WordTiming {
  text: string;
  start: number;
  end: number;
  syl: number;
  bilabial: number[];
}

/**
 * Distribute a cue's duration over its words proportionally to syllable count
 * (with a floor so one-syllable words are readable).
 */
export function wordTimings(cue: { text?: string; start: number; end: number }, lang?: string): WordTiming[] {
  const l = lang || detectLang(cue.text || '');
  const words = (cue.text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const weights = words.map((w) => Math.max(0.6, countSyllables(w, l) || 0.6) + (/[.,;:!?…]$/.test(w) ? 0.45 : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const dur = Math.max(0.05, cue.end - cue.start);
  let t = cue.start;
  return words.map((w, i) => {
    const d = (weights[i] / total) * dur;
    const o = { text: w, start: t, end: t + d, syl: countSyllables(w, l), bilabial: bilabialIdx(w, l) };
    t += d;
    return o;
  });
}

/** syllables per second for a cue — a rough "can a human say this" check */
export const speechRate = (cue: { text?: string; start: number; end: number }, lang?: string) =>
  countText(cue.text || '', lang) / Math.max(0.1, cue.end - cue.start);

/**
 * Where to cut a line's text when the cue is split at time `t`: the word boundary nearest to `t`, using the same
 * syllable-proportional word timing as the rhythm band. Returns [left text, right text] (either may be empty).
 */
export function splitTextAt(cue: { text?: string; start: number; end: number }, t: number, lang?: string): [string, string] {
  const words = wordTimings(cue, lang);
  if (!words.length) return ['', ''];
  let cut = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= words.length; i++) {
    const boundary = i === 0 ? cue.start : i === words.length ? cue.end : words[i].start;
    const d = Math.abs(boundary - t);
    if (d < best) {
      best = d;
      cut = i;
    }
  }
  return [
    words
      .slice(0, cut)
      .map((w) => w.text)
      .join(' '),
    words
      .slice(cut)
      .map((w) => w.text)
      .join(' '),
  ];
}
