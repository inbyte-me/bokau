import { HttpError, json, readJson } from './util.js';
import { countText, countSyllables, detectLang, bilabialIdx } from '../shared/syllables.js';
import { badLipOffline, telenovelaOffline, genreOffline } from './offline.js';

// Only cheap models are selectable (cap safety). Prices are USD per 1M tokens in/out as of build time.
export const MODELS = [
  { id: 'qwen/qwen3.7-flash', label: 'Qwen 3.7 Flash — cheapest (~$0.03/$0.13 per 1M)' },
  { id: 'qwen/qwen3-235b-a22b-2507', label: 'Qwen3 235B — funnier (~$0.09/$0.55)' },
  { id: 'inclusionai/ling-3.0-flash', label: 'Ling 3.0 Flash — tiny (~$0.02/$0.06)' },
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5 — most precise (~$0.10/$0.50)' },
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (~$0.10/$0.40)' },
];

export const GENRES = {
  noir: 'Noir detective: gritty first-person inner monologue, 1940s slang, rain, cigarettes, dames, world-weary similes.',
  pirate: 'Pirate swashbuckler: nautical insults, "arrr", treasure, grog, occasionally a line of a sea shanty.',
  corporate: 'Bad corporate speak: jargon, synergy, alignment, quarterly targets, "circle back", KPIs, passive-aggressive emails.',
  action80s: '80s action movie: every line ends with an explosion-ready one-liner or punchline, macho, over-confident.',
};

const LANG_NAME = { en: 'English', es: 'Spanish (Latin American)', fr: 'French', pt: 'Portuguese', de: 'German', it: 'Italian' };
const langName = (l) => LANG_NAME[l] || l || 'the same language as the input';

function systemPrompt() {
  return 'You are a comedy dubbing-script writer. You write short lines an actor can speak within a given time. Respect the per-line syllable counts (syl) as exactly as you can: the line must fit the mouth movements. Reply with ONLY a JSON object: {"lines":[{"id":"<id>","text":"<line>","character":"<optional name>","direction":"<optional 2-4 word acting direction>"}]}. Keep every id. No markdown.';
}

function buildPrompt(task, { cues, params }) {
  const items = cues.map((c) => ({ id: c.id, text: c.text || '', syl: c.syl, sec: Number(c.dur?.toFixed?.(2) ?? c.dur), ...(c.lips?.length ? { lipsClosedAtWords: c.lips } : {}), ...(c.character ? { who: c.character } : {}), ...(c.previous ? { previous: c.previous, previousSyl: c.previousSyl } : {}) }));
  const out = langName(params.outLang);
  switch (task) {
    case 'translate':
      return `Translate each line from ${langName(params.fromLang)} into ${out}. Keep the meaning and tone. Match the syllable count "syl" of each line (±1) so the dub fits the actor's mouth. Where "lipsClosedAtWords" lists word positions (0-based) where the original speaker closes their lips (M/B/P sounds), try to put a bilabial consonant (m, b, p) at a similar relative position in your line.${params.extra ? ' Extra instructions: ' + params.extra : ''}\nLines: ${JSON.stringify(items)}`;
    case 'badlip':
      return `Bad-lip-reading comedy in ${out}. Premise from the user: "${params.prompt || 'two people arguing about lost cheese'}". Each slot is a stretch of on-screen mouth movement. Write one absurd, funny line per slot, alternating characters (use the "who" field if present, otherwise invent two short names). Match "syl" EXACTLY. If "text" is non-empty, make your line SOUND like it (similar vowels and consonants, same rhythm) while meaning something about the premise. Keep it family-friendly.\nSlots: ${JSON.stringify(items)}`;
    case 'telenovela':
      return `Rewrite each line as an over-the-top telenovela / soap-opera line in ${out}: gasps, betrayal, secret twins, declarations of undying love. Keep each line within about ±25% of "syl" syllables so it fits the timing. Add a short "direction" like "tearful, trembling".\nLines: ${JSON.stringify(items)}`;
    case 'genre': {
      const g = GENRES[params.genre] || GENRES.pirate;
      return `Rewrite each line in the style: ${g} Write in ${out}. Keep the situation but change the voice. Keep each line within about ±25% of "syl" syllables. Add a short "direction".\nLines: ${JSON.stringify(items)}`;
    }
    default: throw new HttpError(400, 'unknown task');
  }
}

function parseModelJson(text) {
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try { const j = JSON.parse(t); return Array.isArray(j) ? j : j.lines; } catch { return null; }
}

export function registerAiRoutes({ ai }) {
  return async function aiRoutes(req, res, seg) {
    if (seg[0] === 'status') return json(res, 200, { ...ai.status(), models: MODELS, genres: Object.keys(GENRES) });
    if (seg[0] === 'rewrite' && req.method === 'POST') {
      const b = await readJson(req, 2 * 1024 * 1024);
      const task = String(b.task);
      if (!['translate', 'badlip', 'telenovela', 'genre'].includes(task)) throw new HttpError(400, 'unknown task');
      const params = b.params || {};
      let cues = Array.isArray(b.cues) ? b.cues.slice(0, 80) : [];
      if (!cues.length) throw new HttpError(400, 'no cues');
      if (cues.reduce((n, c) => n + String(c.text || '').length, 0) > 16000) throw new HttpError(413, 'too much text');
      const srcLang = params.fromLang || detectLang(cues.map((c) => c.text).join(' '));
      const outLang = params.outLang || (task === 'translate' ? 'en' : srcLang);
      cues = cues.map((c) => ({ id: String(c.id), text: String(c.text || '').slice(0, 400), character: c.character ? String(c.character).slice(0, 30) : '',
        dur: Math.max(0.1, Number(c.dur) || (Number(c.end) - Number(c.start)) || 1),
        syl: Math.max(1, Number(c.syl) || countText(c.text || '', srcLang) || Math.round((Number(c.dur) || 1) * 4)),
        lips: (c.text || '').split(/\s+/).map((w, i) => (bilabialIdx(w, srcLang).length ? i : -1)).filter((i) => i >= 0).slice(0, 12) }));
      const model = MODELS.some((m) => m.id === params.model) ? params.model : undefined;
      let lines; let source = 'ai'; let usedModel = null; let costUsd = 0; let notice = null;
      const wantOffline = params.offline === true;
      if (!wantOffline) {
        try {
          const chunks = []; for (let i = 0; i < cues.length; i += 25) chunks.push(cues.slice(i, i + 25));
          lines = [];
          for (const ch of chunks) {
            const r = await ai.complete([{ role: 'system', content: systemPrompt() }, { role: 'user', content: buildPrompt(task, { cues: ch, params: { ...params, outLang, fromLang: srcLang } }) }],
              { model, maxTokens: Math.min(1800, 120 + ch.length * 90), temperature: task === 'translate' ? 0.4 : 1.0, json: true });
            const parsed = parseModelJson(r.text);
            if (!parsed) throw new HttpError(502, 'model returned invalid JSON');
            lines.push(...parsed); usedModel = r.model; costUsd += r.costUsd;
          }
          // one cheap repair pass: re-ask only the lines whose syllable count is clearly off
          if (task === 'translate' || task === 'badlip') {
            const byIdTmp = new Map(lines.map((l) => [String(l.id), l]));
            const bad = cues.filter((c) => { const l = byIdTmp.get(c.id); return l && Math.abs(countText(String(l.text || ''), outLang) - c.syl) > Math.max(1, Math.round(c.syl * 0.2)); }).slice(0, 25);
            if (bad.length) {
              const hints = bad.map((c) => ({ ...c, text: task === 'translate' ? c.text : c.text, previous: byIdTmp.get(c.id).text, previousSyl: countText(String(byIdTmp.get(c.id).text), outLang) }));
              const r = await ai.complete([{ role: 'system', content: systemPrompt() }, { role: 'user', content: buildPrompt(task, { cues: hints, params: { ...params, outLang, fromLang: srcLang, extra: ((params.extra || '') + ' Your previous attempt ("previous") had the wrong syllable count (previousSyl); rewrite it so it has exactly "syl" syllables.').trim() } }) }],
                { model, maxTokens: 120 + bad.length * 90, temperature: 0.7, json: true });
              const fixed = parseModelJson(r.text) || [];
              for (const f of fixed) if (f?.id && f.text) { const old = byIdTmp.get(String(f.id)); const oldErr = Math.abs(countText(String(old.text), outLang) - (cues.find((c) => c.id === String(f.id))?.syl || 0)); const newErr = Math.abs(countText(String(f.text), outLang) - (cues.find((c) => c.id === String(f.id))?.syl || 0)); if (newErr < oldErr) Object.assign(old, f); }
              costUsd += r.costUsd; usedModel = r.model;
            }
          }
        } catch (e) {
          if (task === 'translate') throw e; // no meaningful offline translation
          notice = e.message; lines = null;
        }
      }
      if (!lines) {
        source = 'offline';
        if (task === 'badlip') lines = badLipOffline(cues.map((c) => ({ id: c.id, duration: c.dur, syllables: c.syl })), { lang: outLang, topic: params.prompt || '' });
        else if (task === 'telenovela') lines = telenovelaOffline(cues, { lang: outLang });
        else if (task === 'genre') lines = genreOffline(cues, { genre: params.genre });
        else throw new HttpError(503, 'AI unavailable');
      }
      const byId = new Map(lines.map((l) => [String(l.id), l]));
      const result = cues.map((c) => {
        const l = byId.get(c.id);
        const text = String(l?.text ?? c.text).trim();
        return { id: c.id, text, character: l?.character || c.character || '', direction: l?.direction || '', syllables: countText(text, outLang), target: c.syl, changed: !!l };
      });
      return json(res, 200, { lines: result, source, model: usedModel, costUsd, notice, spend: ai.status() });
    }
    throw new HttpError(404, 'not found');
  };
}
