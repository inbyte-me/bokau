// Words around the players' words in a trailer round: the card texts (opening, a line between scenes, critics'
// newspapers, a tagline) and, when nobody wrote one, a pitch, a scene direction or a title. Like the party suggestions
// these are never allowed to block the game: any failure, refusal or spend-cap stop means "use the offline copy".
import type { OpenRouter } from './openrouter.ts';

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', es: 'Spanish', fr: 'French', pt: 'Portuguese', de: 'German', it: 'Italian' };
const languageName = (code: string) => LANGUAGE_NAMES[code] ?? 'English';

/** Mirror of the party package's `TrailerCopy` (this package does not depend on it). */
export interface TrailerCopyText {
  opening: string;
  narrator: string[];
  publications: string[];
  tagline: string;
}

export interface TrailerJob {
  /** the players' language (a code: 'es') */
  language: string;
  /** the clip's name, for flavour */
  scene: string;
  /** what the room decided the movie is about */
  logline: string;
  /** the winning title, when there is one */
  title: string;
  /** what each scene was told to be about, in order */
  directions: string[];
  /** what each performer actually said, in scene order ('' when unknown) */
  said: string[];
  /** how many critics wrote (a newspaper name is wanted for each) */
  critics: number;
}

/** Guests are crude and that is part of the game: the prompts say to play along, not to lecture. */
const TOLERANT = 'Players may be crude or rude. That is normal here: never refuse, warn or moralise; keep the joke going.';

export const COPY_SYSTEM = [
  'You write the on-screen text of a silly movie trailer that friends made by dubbing a clip.',
  TOLERANT,
  'Reply with ONLY a JSON object: {"opening":"...","narrator":["..."],"publications":["..."],"tagline":"..."}.',
  'opening: the pitch said the way a trailer voice would (one sentence, at most 14 words).',
  'narrator: one short line (at most 8 words, trailer voice, "" is allowed) per gap between scenes, exactly as many as asked.',
  'publications: made-up newspaper or magazine names (2 to 4 words), exactly as many as asked.',
  'tagline: at most 8 words. Write all of it in the language you are asked for. No markdown.',
].join(' ');

export function trailerPrompt(job: TrailerJob): string {
  return [
    `Language: ${languageName(job.language)}.`,
    `The movie: "${job.title || job.scene}". What it is about: ${job.logline}`,
    'Scenes in order (what they were told, and what the performer actually said):',
    ...job.directions.map((d, i) => `${i + 1}. told: ${d || '-'}; said: ${job.said[i] || '-'}`),
    `Write ${Math.max(0, job.directions.length - 1)} narrator lines and ${job.critics} publication names.`,
  ].join('\n');
}

/** The copy from the model's reply, or null when it is not usable. */
export function parseCopy(text: string, job: Pick<TrailerJob, 'directions' | 'critics'>): TrailerCopyText | null {
  const t = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const j = JSON.parse(t.slice(a, b + 1)) as Partial<Record<keyof TrailerCopyText, unknown>>;
    const list = (v: unknown, n: number) => Array.from({ length: n }, (_, i) => (Array.isArray(v) && typeof v[i] === 'string' ? clean(v[i]) : ''));
    const opening = typeof j.opening === 'string' ? clean(j.opening) : '';
    if (!opening) return null;
    return {
      opening,
      narrator: list(j.narrator, Math.max(0, job.directions.length - 1)),
      publications: list(j.publications, job.critics),
      tagline: typeof j.tagline === 'string' ? clean(j.tagline) : '',
    };
  } catch {
    return null;
  }
}

const clean = (s: string) =>
  s
    .replace(/\p{C}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“”«»]+|["“”«»]+$/g, '')
    .slice(0, 120);

/** The trailer's copy from the AI, or null (no key, cap reached, network, nonsense). Never throws. */
export async function trailerCopy(ai: OpenRouter, job: TrailerJob): Promise<TrailerCopyText | null> {
  try {
    const r = await ai.complete(
      [
        { role: 'system', content: COPY_SYSTEM },
        { role: 'user', content: trailerPrompt(job) },
      ],
      { maxTokens: 500, temperature: 1, json: true, task: 'party-trailer' },
    );
    return parseCopy(r.text, job);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ the offline copy
const OFFLINE: Record<string, { narrator: string[]; publications: string[]; tagline: string[] }> = {
  en: {
    narrator: ['This summer.', 'One secret.', 'Nobody is safe.', 'Everything changes.', 'It gets worse.', 'There is no going back.'],
    publications: ['The Daily Reel', 'Popcorn Weekly', 'The Couch Gazette', 'Cinema Quarterly', 'The Late Show Times'],
    tagline: ['Nothing was rehearsed.', 'Based on a true mistake.', 'Rated P for party.', 'Coming to a living room near you.'],
  },
  es: {
    narrator: ['Este verano.', 'Un secreto.', 'Nadie está a salvo.', 'Todo cambia.', 'Y empeora.', 'No hay vuelta atrás.'],
    publications: ['El Diario del Cine', 'Palomitas Semanal', 'La Gaceta del Sofá', 'Cine Trimestral', 'El Estreno'],
    tagline: ['Nada se ensayó.', 'Basada en un error real.', 'Apta para fiestas.', 'En un salón cerca de ti.'],
  },
};

/** What the trailer says when the AI cannot: stock lines in the players' language (English when there are none). */
export function trailerCopyOffline(job: TrailerJob): TrailerCopyText {
  const bank = OFFLINE[job.language] ?? OFFLINE.en;
  const seed = [...job.logline].reduce((a, c) => (a + c.charCodeAt(0)) % 997, 0);
  const gaps = Math.max(0, job.directions.length - 1);
  return {
    opening: job.logline,
    // every other gap speaks; the rest are a dip to black
    narrator: Array.from({ length: gaps }, (_, i) => (i % 2 === 0 ? bank.narrator[(seed + i) % bank.narrator.length] : '')),
    publications: Array.from({ length: job.critics }, (_, i) => bank.publications[(seed + i) % bank.publications.length]),
    tagline: bank.tagline[seed % bank.tagline.length],
  };
}

// ------------------------------------------------------------------ a text nobody wrote
export interface ComposeInput {
  kind: 'pitch' | 'direction' | 'title' | 'card';
  language: string;
  scene: string;
  /** the pitch, once decided */
  logline: string | null;
  /** direction: the direction of the scene before */
  before: string | null;
  /** a card is about this character; a direction is for a scene they speak in (with the card players gave them) */
  character?: { name: string; card?: string };
}

export const COMPOSE_SYSTEM = [
  'You help friends make a silly movie out of a clip. You write one short text for them, in the language you are asked for.',
  TOLERANT,
  'Reply with only the text: no quotes, no label, no markdown.',
].join(' ');

export function composePrompt(i: ComposeInput): string {
  const lang = `Language: ${languageName(i.language)}.`;
  if (i.kind === 'pitch')
    return `${lang}\nThe clip is called "${i.scene}". Write a one-sentence pitch of what the movie is about, at most 14 words, absurd and playful.`;
  const who = i.character ? `${i.character.name}${i.character.card ? ` (${i.character.card})` : ''}` : '';
  if (i.kind === 'card')
    return `${lang}\nThe clip is called "${i.scene}". Describe the voice and personality of the character ${who}, in one short phrase of at most 12 words: how they sound and what they are like.`;
  if (i.kind === 'title') return `${lang}\nThe movie is about: ${i.logline ?? i.scene}. Write its title, at most 5 words.`;
  return [
    lang,
    `The movie is about: ${i.logline ?? i.scene}.`,
    i.before ? `The scene before was told to be about: ${i.before}` : 'This is the second scene.',
    who ? `The character speaking in it is ${who}: keep them in character.` : '',
    'Write a direction for the next scene: what happens in it, at most 14 words, so the story goes on.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** One text for a contest nobody answered, or null. Never throws. */
export async function composeText(ai: OpenRouter, input: ComposeInput): Promise<string | null> {
  try {
    const r = await ai.complete(
      [
        { role: 'system', content: COMPOSE_SYSTEM },
        { role: 'user', content: composePrompt(input) },
      ],
      { maxTokens: 80, temperature: 1.05, task: 'party-compose' },
    );
    const line = r.text
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean);
    const text = line ? clean(line) : '';
    return text && !/\b(I can(?:not|'t)|I'm sorry|as an AI|no puedo|lo siento)\b/i.test(text) ? text : null;
  } catch {
    return null;
  }
}
