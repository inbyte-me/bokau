import { AppError, bilabialIdx, countText, detectLang, errorMessage, type RewriteCueInput, type RewriteParams, type RewriteResult } from '@doblaje/core';
import { badLipOffline, genreOffline, type OfflineLine, telenovelaOffline } from './offline.ts';
import type { OpenRouter } from './openrouter.ts';
import { buildPrompt, isAllowedModel, isGenre, type ModelLine, type PromptCue, parseModelJson, systemPrompt, type Task } from './prompts.ts';

export type { RewriteCueInput, RewriteParams, RewriteResult, RewrittenLine } from '@doblaje/core';

const MAX_CUES = 80;
const MAX_CHARS = 16000;
const CHUNK = 25;

function prepare(cues: RewriteCueInput[], srcLang: string): PromptCue[] {
  return cues.map((c) => {
    const text = String(c.text || '').slice(0, 400);
    const dur = Math.max(0.1, Number(c.dur) || Number(c.end) - Number(c.start) || 1);
    return {
      id: String(c.id),
      text,
      character: c.character ? String(c.character).slice(0, 30) : '',
      dur,
      syl: Math.max(1, Number(c.syl) || countText(text, srcLang) || Math.round(dur * 4)),
      lips: text
        .split(/\s+/)
        .map((w, i) => (bilabialIdx(w, srcLang).length ? i : -1))
        .filter((i) => i >= 0)
        .slice(0, 12),
    };
  });
}

/**
 * Rewrite or translate cues with the model, fitted to each line's syllable count.
 * One cheap repair pass re-asks only the lines whose count is clearly off. If the model is unavailable
 * (no key, cap reached, network) the party tasks fall back to offline generators; translation does not.
 */
export async function rewrite(ai: OpenRouter, task: Task, input: RewriteCueInput[], params: RewriteParams = {}): Promise<RewriteResult> {
  const raw = input.slice(0, MAX_CUES);
  if (!raw.length) throw new AppError(400, 'no cues');
  if (raw.reduce((n, c) => n + String(c.text || '').length, 0) > MAX_CHARS) throw new AppError(413, 'too much text');
  const srcLang = params.fromLang || detectLang(raw.map((c) => c.text || '').join(' '));
  const outLang = params.outLang || (task === 'translate' ? 'en' : srcLang);
  const cues = prepare(raw, srcLang);
  const model = isAllowedModel(params.model) ? params.model : undefined;
  const p = { ...params, outLang, fromLang: srcLang };

  let lines: (ModelLine | OfflineLine)[] | null = null;
  let source: RewriteResult['source'] = 'ai';
  let usedModel: string | null = null;
  let costUsd = 0;
  let notice: string | null = null;

  if (params.offline !== true) {
    try {
      const got: ModelLine[] = [];
      for (let i = 0; i < cues.length; i += CHUNK) {
        const ch = cues.slice(i, i + CHUNK);
        const r = await ai.complete(
          [
            { role: 'system', content: systemPrompt() },
            { role: 'user', content: buildPrompt(task, ch, p) },
          ],
          { model, maxTokens: Math.min(1800, 120 + ch.length * 90), temperature: task === 'translate' ? 0.4 : 1.0, json: true, task },
        );
        const parsed = parseModelJson(r.text);
        if (!parsed) throw new AppError(502, 'model returned invalid JSON');
        got.push(...parsed);
        usedModel = r.model;
        costUsd += r.costUsd;
      }
      if (task === 'translate' || task === 'badlip') {
        const byId = new Map(got.map((l) => [String(l.id), l]));
        const err = (text: string, c: PromptCue) => Math.abs(countText(text, outLang) - c.syl);
        const bad = cues.filter((c) => {
          const l = byId.get(c.id);
          return l && err(String(l.text || ''), c) > Math.max(1, Math.round(c.syl * 0.2));
        });
        if (bad.length) {
          const hints = bad.slice(0, CHUNK).map((c) => {
            const prev = String(byId.get(c.id)?.text || '');
            return { ...c, previous: prev, previousSyl: countText(prev, outLang) };
          });
          const extra =
            `${params.extra || ''} Your previous attempt ("previous") had the wrong syllable count (previousSyl); rewrite it so it has exactly "syl" syllables.`.trim();
          const r = await ai.complete(
            [
              { role: 'system', content: systemPrompt() },
              { role: 'user', content: buildPrompt(task, hints, { ...p, extra }) },
            ],
            { model, maxTokens: 120 + hints.length * 90, temperature: 0.7, json: true, task: `${task}-repair` },
          );
          for (const f of parseModelJson(r.text) || []) {
            const old = f?.id != null ? byId.get(String(f.id)) : undefined;
            const cue = cues.find((c) => c.id === String(f?.id));
            if (old && cue && f.text && err(String(f.text), cue) < err(String(old.text || ''), cue)) Object.assign(old, f);
          }
          costUsd += r.costUsd;
          usedModel = r.model;
        }
      }
      lines = got;
    } catch (e) {
      if (task === 'translate') throw e; // no meaningful offline translation
      notice = errorMessage(e);
    }
  }
  if (!lines) {
    source = 'offline';
    if (task === 'badlip')
      lines = badLipOffline(
        cues.map((c) => ({ id: c.id, duration: c.dur, syllables: c.syl })),
        { lang: outLang, topic: params.prompt || '' },
      );
    else if (task === 'telenovela') lines = telenovelaOffline(cues, { lang: outLang });
    else if (task === 'genre') lines = genreOffline(cues, { genre: isGenre(params.genre) ? params.genre : 'pirate' });
    else throw new AppError(503, 'AI unavailable');
  }
  const byId = new Map(lines.map((l) => [String(l.id), l]));
  return {
    lines: cues.map((c) => {
      const l = byId.get(c.id);
      const text = String(l?.text ?? c.text).trim();
      return {
        id: c.id,
        text,
        character: l?.character || c.character || '',
        direction: (l && 'direction' in l && l.direction) || '',
        syllables: countText(text, outLang),
        target: c.syl,
        changed: !!l,
      };
    }),
    source,
    model: usedModel,
    costUsd,
    notice,
  };
}
