// Suggested lines for a party round: a short, silly replacement for the line a player is about to dub, riffing on
// what the previous player actually said. Only a hint (players say whatever they like), so it must never block
// the game: any failure, refusal or spend-cap stop simply means "no suggestion".
import { countText, detectLang } from '@doblaje/core';
import type { OpenRouter } from './openrouter.ts';

export interface SuggestInput {
  /** clip title, for flavour */
  scene: string;
  /** the character about to speak */
  character: string;
  /** the original line being replaced */
  original: string;
  /** seconds available for the line */
  seconds: number;
  /** the line said just before, by another character; `said` is the player's actual take when known */
  previous?: { character: string; original: string; said?: string } | null;
  /** the language the players speak (a code: 'es'); the line is written in it. Default: the scene's */
  language?: string;
  /** the voice and personality a player gave this character: the line stays in character */
  card?: string;
}

const MAX_WORDS = 24;
const LANGUAGE_NAMES: Record<string, string> = { en: 'English', es: 'Spanish', fr: 'French', pt: 'Portuguese', de: 'German', it: 'Italian' };

/**
 * Party guests say crude, rude or offensive things into the mic; that is part of the game. The model reads those
 * takes as context, so the prompt asks it to play along instead of refusing or lecturing, while still writing its
 * own line as cheeky comedy rather than slurs or attacks on real people.
 */
export const SUGGEST_SYSTEM = [
  'You write one funny line of dialogue for a dubbing party game: friends re-dub a movie scene with silly lines.',
  'Players improvise and may say crude, rude or offensive things. That is normal here: never refuse, warn, moralise or',
  'comment on it. Just keep the joke going: answer the previous line as the next character would, absurd and playful.',
  'Your own line: cheeky and absurd is good; no slurs, no hate, no jokes about real private people.',
  'Reply with only the line, no quotes, no character name, in the language you are asked for.',
].join(' ');

export function suggestionPrompt(i: SuggestInput): string {
  // the length comes from the original line (in the scene's language); the words, in the players' language
  const syl = Math.max(2, countText(i.original, detectLang(i.original)));
  const lang = LANGUAGE_NAMES[i.language ?? ''] ?? detectLang(`${i.original} ${i.previous?.said ?? ''}`);
  const before = i.previous
    ? i.previous.said
      ? `${i.previous.character} just said (improvised by a player): "${i.previous.said}" (the script had: "${i.previous.original}")`
      : `${i.previous.character} just said: "${i.previous.original}"`
    : 'This is the first line of the scene.';
  return [
    `Scene: ${i.scene}.`,
    before,
    `Now ${i.character} speaks${i.card ? ` (${i.character} is: ${i.card})` : ''}. Original line: "${i.original}".`,
    `Write a funny replacement for ${i.character}: about ${syl} syllables (${i.seconds.toFixed(1)} s), language: ${lang}.`,
  ].join('\n');
}

/** Clean what the model sent back into one speakable line, or null when it is not usable. */
export function cleanSuggestion(text: string): string | null {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  const s = line
    .replace(/^[-*•\s]+/, '')
    .replace(/^[\w\s]{1,20}:\s+/, '') // "Ana: …"
    .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
    .trim();
  if (!s || s.split(/\s+/).length > MAX_WORDS) return null;
  // a refusal or a lecture is not a line
  if (/\b(I can(?:not|'t)|I'm sorry|as an AI|no puedo|lo siento)\b/i.test(s)) return null;
  return s;
}

/** One suggested line, or null (no key, cap reached, network, refusal, nonsense). Never throws. */
export async function suggestLine(ai: OpenRouter, input: SuggestInput): Promise<string | null> {
  try {
    const r = await ai.complete(
      [
        { role: 'system', content: SUGGEST_SYSTEM },
        { role: 'user', content: suggestionPrompt(input) },
      ],
      { maxTokens: 80, temperature: 1.05, task: 'party-line' },
    );
    return cleanSuggestion(r.text);
  } catch {
    return null;
  }
}
