import { countSyllables, countText, detectLang } from '../shared/syllables.js';

// Offline stand-ins used when no OpenRouter key is available (or the spend cap is hit).
// They are deliberately silly: enough to keep the party games playable without internet.

const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
let rng = 1;
const rnd = (n) => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng % n; };

const BANK = {
  en: {
    1: ['cheese', 'wait', 'no', 'fridge', 'look', 'gone', 'mine', 'why', 'toast', 'sock', 'hey', 'stop', 'moon', 'goose', 'bread'],
    2: ['cheddar', 'seriously', 'pickle', 'basement', 'monday', 'noodle', 'banjo', 'giraffe', 'tuesday', 'kitchen', 'nobody', 'trombone'],
    3: ['mozzarella', 'absolutely', 'telephone', 'spaghetti', 'butterfly', 'hippopotamus', 'umbrella', 'unbelievable'],
    4: ['unreasonable', 'refrigerator', 'accidentally', 'electricity', 'deliciously'],
  },
  es: {
    1: ['queso', 'no', 'sal', 'pan', 'mi', 'ya', 'luz', 'sol', 'pie', 'tos'],
    2: ['cebolla', 'ventana', 'chancla', 'tamal', 'nunca', 'perro', 'mañana', 'tortilla'],
    3: ['refrigerador', 'increíble', 'calabaza', 'maravilla', 'zapatilla', 'mariposa'],
    4: ['definitivamente', 'extraordinario', 'imposible', 'melancólico'],
  },
};
const CHARS = ['A', 'B'];

// regroup the banks by the syllable counter we actually score with, so slots always match
const BYSYL = {};
for (const [lang, groups] of Object.entries(BANK)) {
  BYSYL[lang] = {};
  for (const w of Object.values(groups).flat()) (BYSYL[lang][countSyllables(w, lang)] ||= []).push(w);
}

/** Fill each slot with silly words so the syllable count matches exactly. */
export function badLipOffline(segments, { lang = 'en', topic = '' } = {}) {
  const bank = BYSYL[lang] || BYSYL.en;
  const topicWords = topic.toLowerCase().split(/[^a-záéíóúñ]+/).filter((w) => w.length > 3).slice(0, 6);
  return segments.map((s, i) => {
    let left = Math.max(1, s.syllables || Math.round(s.duration * 4)); const words = [];
    while (left > 0) {
      const tw = topicWords.length && rnd(3) === 0 ? topicWords[rnd(topicWords.length)] : null;
      const twN = tw ? countSyllables(tw, lang) : 0;
      if (tw && twN > 0 && twN <= left) { words.push(tw); left -= twN; continue; }
      let k = Math.min(left, 1 + rnd(Math.min(4, left)));
      while (!bank[k]) k--; // always has 1-syllable words
      words.push(pick(bank[k], rnd(100))); left -= k;
    }
    let text = words.join(' ');
    text = text[0].toUpperCase() + text.slice(1) + (rnd(4) === 0 ? '?!' : '.');
    return { id: s.id, character: CHARS[i % 2], text };
  });
}

const TELE_PRE = {
  en: ['How could you do this to me?!', 'I trusted you, and THIS is my reward?', 'Everything I believed in is a lie!', 'Look me in the eyes and say it!'],
  es: ['¡¿Cómo pudiste hacerme esto?!', '¡Confié en ti y así me lo pagas!', '¡Todo en lo que creí es una mentira!', '¡Mírame a los ojos y dilo!'],
};
const TELE_POST = {
  en: ['...and now my heart is shattered forever!', '...I will never forgive you!', '...it was all because of love!', '...you are DEAD to me!'],
  es: ['...¡y ahora mi corazón se rompió para siempre!', '...¡jamás te lo perdonaré!', '...¡todo fue por amor!', '...¡para mí estás muerto!'],
};
export function telenovelaOffline(cues, { lang }) {
  lang = lang || detectLang(cues.map((c) => c.text).join(' '));
  return cues.map((c, i) => ({ id: c.id, text: `${pick(TELE_PRE[lang] || TELE_PRE.en, i)} ${c.text.replace(/[.!?]+$/, '')}${pick(TELE_POST[lang] || TELE_POST.en, i * 7 + 3)}` }));
}

const SWAPS = {
  pirate: [[/\byou\b/gi, 'ye'], [/\byour\b/gi, 'yer'], [/\bmy\b/gi, 'me'], [/\bhello\b|\bhi\b/gi, 'ahoy'], [/\bfriend\b/gi, 'matey'], [/\bis\b/gi, 'be'], [/\bare\b/gi, 'be'], [/\bthe\b/gi, 'th\''], [/\bmoney\b/gi, 'doubloons'], [/\bcoffee\b/gi, 'grog']],
  corporate: [[/\bhelp\b/gi, 'leverage synergies for'], [/\bidea\b/gi, 'value proposition'], [/\bproblem\b/gi, 'opportunity'], [/\bnow\b/gi, 'going forward'], [/\bmeeting\b/gi, 'alignment session'], [/\bwork\b/gi, 'deliverable'], [/\bgood\b/gi, 'best-in-class'], [/\bwant\b/gi, 'are incentivized to']],
};
const POST = {
  pirate: ['Arrr!', 'Yo ho ho!', 'Shiver me timbers!', 'Savvy?'],
  corporate: ['Let\'s circle back offline.', 'That moves the needle on Q3.', 'Per my last email.', 'Let\'s take this to a deep dive.'],
  noir: ['The rain kept falling. So did I.', 'It was that kind of town.', 'Trouble wore perfume that night.', 'I lit a smoke and let the silence talk.'],
  action80s: ['Hasta la vista, baby.', 'Consider that a divorce.', 'Class dismissed.', 'Yippee-ki-yay.'],
};
export function genreOffline(cues, { genre = 'pirate' }) {
  return cues.map((c, i) => {
    let t = c.text;
    for (const [re, to] of SWAPS[genre] || []) t = t.replace(re, to);
    const post = pick(POST[genre] || POST.pirate, i * 5 + 1);
    const pre = genre === 'noir' ? 'She walked in like trouble. ' : '';
    return { id: c.id, text: (pre + t.replace(/\s+$/, '') + ' ' + post).trim() };
  });
}
export { countText };
