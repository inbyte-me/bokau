import { AI_TASKS, type AiTask } from '@doblaje/core';

// Only cheap models are selectable (cap safety). Prices are USD per 1M tokens in/out as of build time.
export const MODELS = [
  { id: 'qwen/qwen3.7-flash', label: 'Qwen 3.7 Flash — cheapest (~$0.03/$0.13 per 1M)' },
  { id: 'qwen/qwen3-235b-a22b-2507', label: 'Qwen3 235B — funnier (~$0.09/$0.55)' },
  { id: 'inclusionai/ling-3.0-flash', label: 'Ling 3.0 Flash — tiny (~$0.02/$0.06)' },
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5 — most precise (~$0.10/$0.50)' },
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (~$0.10/$0.40)' },
] as const;
export const isAllowedModel = (m: unknown): m is string => MODELS.some((x) => x.id === m);

export const GENRES = {
  noir: 'Noir detective: gritty first-person inner monologue, 1940s slang, rain, cigarettes, dames, world-weary similes.',
  pirate: 'Pirate swashbuckler: nautical insults, "arrr", treasure, grog, occasionally a line of a sea shanty.',
  corporate: 'Bad corporate speak: jargon, synergy, alignment, quarterly targets, "circle back", KPIs, passive-aggressive emails.',
  action80s: '80s action movie: every line ends with an explosion-ready one-liner or punchline, macho, over-confident.',
} as const;
export type GenreId = keyof typeof GENRES;
export const isGenre = (g: unknown): g is GenreId => typeof g === 'string' && g in GENRES;

export const TASKS = AI_TASKS;
export type Task = AiTask;
export const isTask = (t: unknown): t is Task => TASKS.includes(t as Task);

const LANG_NAME: Record<string, string> = { en: 'English', es: 'Spanish (Latin American)', fr: 'French', pt: 'Portuguese', de: 'German', it: 'Italian' };
const langName = (l?: string) => (l && LANG_NAME[l]) || l || 'the same language as the input';

/** A cue as sent to the model. */
export interface PromptCue {
  id: string;
  text: string;
  character: string;
  dur: number;
  syl: number;
  /** word positions where the original speaker closes their lips */
  lips: number[];
  previous?: string;
  previousSyl?: number;
}
export interface PromptParams {
  fromLang?: string;
  outLang?: string;
  prompt?: string;
  genre?: string;
  extra?: string;
}

export function systemPrompt(): string {
  return 'You are a comedy dubbing-script writer. You write short lines an actor can speak within a given time. Respect the per-line syllable counts (syl) as exactly as you can: the line must fit the mouth movements. Reply with ONLY a JSON object: {"lines":[{"id":"<id>","text":"<line>","character":"<optional name>","direction":"<optional 2-4 word acting direction>"}]}. Keep every id. No markdown.';
}

export function buildPrompt(task: Task, cues: PromptCue[], params: PromptParams): string {
  const items = cues.map((c) => ({
    id: c.id,
    text: c.text || '',
    syl: c.syl,
    sec: Number(c.dur.toFixed(2)),
    ...(c.lips.length ? { lipsClosedAtWords: c.lips } : {}),
    ...(c.character ? { who: c.character } : {}),
    ...(c.previous ? { previous: c.previous, previousSyl: c.previousSyl } : {}),
  }));
  const out = langName(params.outLang);
  switch (task) {
    case 'translate':
      return `Translate each line from ${langName(params.fromLang)} into ${out}. Keep the meaning and tone. Match the syllable count "syl" of each line (±1) so the dub fits the actor's mouth. Where "lipsClosedAtWords" lists word positions (0-based) where the original speaker closes their lips (M/B/P sounds), try to put a bilabial consonant (m, b, p) at a similar relative position in your line.${params.extra ? ` Extra instructions: ${params.extra}` : ''}\nLines: ${JSON.stringify(items)}`;
    case 'badlip':
      return `Bad-lip-reading comedy in ${out}. Premise from the user: "${params.prompt || 'two people arguing about lost cheese'}". Each slot is a stretch of on-screen mouth movement. Write one absurd, funny line per slot, alternating characters (use the "who" field if present, otherwise invent two short names). Match "syl" EXACTLY. If "text" is non-empty, make your line SOUND like it (similar vowels and consonants, same rhythm) while meaning something about the premise. Keep it family-friendly.${params.extra ? ` ${params.extra}` : ''}\nSlots: ${JSON.stringify(items)}`;
    case 'telenovela':
      return `Rewrite each line as an over-the-top telenovela / soap-opera line in ${out}: gasps, betrayal, secret twins, declarations of undying love. Keep each line within about ±25% of "syl" syllables so it fits the timing. Add a short "direction" like "tearful, trembling".\nLines: ${JSON.stringify(items)}`;
    case 'genre': {
      const g = GENRES[isGenre(params.genre) ? params.genre : 'pirate'];
      return `Rewrite each line in the style: ${g} Write in ${out}. Keep the situation but change the voice. Keep each line within about ±25% of "syl" syllables. Add a short "direction".\nLines: ${JSON.stringify(items)}`;
    }
  }
}

export interface ModelLine {
  id?: string | number;
  text?: string;
  character?: string;
  direction?: string;
}

/** Tolerant parse of the model's JSON reply (code fences, prose around it, bare arrays). */
export function parseModelJson(text: string): ModelLine[] | null {
  let t = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a && !t.startsWith('[')) t = t.slice(a, b + 1);
  try {
    const j = JSON.parse(t) as ModelLine[] | { lines?: ModelLine[] };
    const lines = Array.isArray(j) ? j : j.lines;
    return Array.isArray(lines) ? lines : null;
  } catch {
    return null;
  }
}
