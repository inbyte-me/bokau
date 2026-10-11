import { api } from './api.js';
import { countText, detectLang } from '/shared/syllables.js';

export const AI_MODEL_KEY = 'aiModel';
export const getModel = () => { try { return localStorage.getItem(AI_MODEL_KEY) || undefined; } catch { return undefined; } };
export const setModel = (m) => { try { localStorage.setItem(AI_MODEL_KEY, m); } catch {} };

/** cues: [{id,text,start,end,character}] -> [{id,text,character,direction,syllables,target}] + {source,model,costUsd,notice} */
export async function rewriteCues(task, cues, params = {}) {
  const body = { task, params: { model: getModel(), ...params }, cues: cues.map((c) => ({ id: c.id, text: c.text || '', character: c.character || '', dur: Math.max(0.1, c.end - c.start), syl: c.syl || countText(c.text || '', params.fromLang || detectLang(c.text || '')) || undefined })) };
  return api.post('/api/ai/rewrite', body);
}
export const aiStatus = () => api.get('/api/ai/status');
