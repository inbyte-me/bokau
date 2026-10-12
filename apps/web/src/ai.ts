import { type Cue, countText, detectLang, type RewriteParams, type AiTask as Task } from '@doblaje/core';
import { api, type RewriteResponse } from './api.ts';

export const AI_MODEL_KEY = 'aiModel';
export const getModel = (): string | undefined => {
  try {
    return localStorage.getItem(AI_MODEL_KEY) || undefined;
  } catch {
    return undefined;
  }
};
export const setModel = (m: string): void => {
  try {
    localStorage.setItem(AI_MODEL_KEY, m);
  } catch {}
};

type CueLike = Pick<Cue, 'id' | 'start' | 'end'> & Partial<Pick<Cue, 'text' | 'character'>> & { syl?: number };

/** Ask the server to rewrite/translate cues, each fitted to its syllable count. */
export async function rewriteCues(task: Task, cues: CueLike[], params: RewriteParams = {}): Promise<RewriteResponse> {
  const body = {
    task,
    params: { model: getModel(), ...params },
    cues: cues.map((c) => ({
      id: c.id,
      text: c.text || '',
      character: c.character || '',
      dur: Math.max(0.1, c.end - c.start),
      syl: c.syl || countText(c.text || '', params.fromLang || detectLang(c.text || '')) || undefined,
    })),
  };
  return api.post<RewriteResponse>('/api/ai/rewrite', body);
}
export const aiStatus = () => api.aiStatus();
