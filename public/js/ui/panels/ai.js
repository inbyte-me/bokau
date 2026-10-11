import { h, clear, toast } from '../../util.js';
import { t } from '../../i18n.js';
import { app } from '../../app.js';
import { rewriteCues, aiStatus, getModel, setModel } from '../../ai.js';

const LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['pt', 'Português'], ['de', 'Deutsch'], ['it', 'Italiano']];

export function mountAi(root) {
  const status = h('div.hint#ai-status', '…'); const results = h('div.col#ai-results');
  const modelSel = h('select#ai-model', { onchange: (e) => setModel(e.target.value) });
  aiStatus().then((s) => {
    for (const m of s.models) modelSel.append(h('option', { value: m.id, selected: (getModel() || s.model) === m.id }, m.label));
    status.textContent = s.configured ? `OpenRouter · ${t('spent')} $${s.spentUsd.toFixed(4)} / $${s.capUsd} ${t('local cap')} · ${s.calls} ${t('calls')}` : t('No API key: translation is unavailable, party tasks use the offline fun-generator.');
  }).catch(() => (status.textContent = t('AI status unavailable')));

  const task = h('select#ai-task', ...[['translate', t('Translate (syllable-matched)')], ['genre:noir', '🕵️ ' + t('Genre: Noir detective')], ['genre:pirate', '🏴‍☠️ ' + t('Genre: Pirate')], ['genre:corporate', '💼 ' + t('Genre: Bad corporate speak')], ['genre:action80s', '💥 ' + t('Genre: 80s action movie')], ['telenovela', '💔 ' + t('Telenovela overdrive')]].map(([v, l]) => h('option', { value: v }, l)));
  const from = h('select#ai-from', h('option', { value: '' }, t('Auto-detect')), ...LANGS.map(([v, l]) => h('option', { value: v }, l)));
  const to = h('select#ai-to', ...LANGS.map(([v, l]) => h('option', { value: v, selected: v === (document.documentElement.lang === 'es' ? 'en' : 'es') }, l)));
  const extra = h('textarea#ai-extra', { rows: 3, placeholder: t('Extra instructions, e.g. "Translate into English matching the original 7 syllables, with M/B/P where the character closes their lips" or "keep it formal"') });
  const scope = h('select#ai-scope', h('option', { value: 'all' }, t('All cues')), h('option', { value: 'sel' }, t('Selected cue only')));

  const run = async () => {
    const cues = scope.value === 'sel' ? app.project.cues.filter((c) => c.id === app.sel.cueId) : app.project.cues;
    if (!cues.length) return toast(t('Add or import some cues first'), 'error');
    const [kind, genre] = task.value.split(':'); go.disabled = true; clear(results); results.append(h('div.hint', t('Thinking…')));
    try {
      const r = await rewriteCues(kind, cues, { fromLang: from.value || undefined, outLang: kind === 'translate' ? to.value : (from.value || undefined), genre, extra: extra.value || undefined });
      clear(results);
      results.append(h('div.hint', `${r.source === 'ai' ? '🤖 ' + (r.model || '') : '📴 ' + t('offline generator')}${r.costUsd ? ` · $${r.costUsd.toFixed(5)}` : ''}${r.notice ? ' · ' + r.notice : ''}`));
      const applyMany = (ls) => app.store.commit('AI rewrite', (pr) => { for (const l of ls) { const cue = pr.cues.find((c) => c.id === l.id); if (!cue) continue; cue.orig ??= cue.text; cue.text = l.text; if (l.character && !cue.character) cue.character = l.character; if (l.direction) cue.direction = l.direction; } }, ['cues']);
      const apply = (l) => applyMany([l]);
      results.append(h('div.row', h('button.primary#ai-apply-all', { onclick: () => { applyMany(r.lines.filter((l) => l.changed)); toast(t('Applied'), 'ok'); } }, t('Apply all')), h('button', { onclick: () => clear(results) }, t('Discard'))));
      for (const l of r.lines) {
        const cue = app.project.cues.find((c) => c.id === l.id); const diff = l.syllables - l.target;
        results.append(h('div.cue', h('div.small.dim', cue?.text), h('div', { style: { fontWeight: 600 } }, l.text), l.direction ? h('div.small.dim', `🎭 ${l.direction}`) : null,
          h('div.row', h('span.syl' + (Math.abs(diff) > 2 ? '.bad' : Math.abs(diff) > 0 ? '.off' : ''), `${l.syllables}/${l.target} syl`), h('div.spacer'), h('button', { onclick: () => apply(l) }, t('Use this line')))));
      }
      aiStatus().then((s) => (status.textContent = `OpenRouter · $${s.spentUsd.toFixed(4)} / $${s.capUsd}`));
    } catch (e) { clear(results); results.append(h('div.hint.warn', e.message)); } finally { go.disabled = false; }
  };
  const go = h('button.primary#ai-go', { onclick: run }, '✨ ' + t('Generate'));
  root.append(h('div.box', h('h4', t('Translation & localization assistant')), h('div.field', h('label', t('Task')), task), h('div.row', h('div.field.grow', h('label', t('From')), from), h('div.field.grow', h('label', t('To')), to)), extra,
    h('div.row', h('div.field.grow', h('label', t('Apply to')), scope), h('div.field.grow', h('label', t('Model')), modelSel)), go, status,
    h('div.hint', t('Each line is fitted to the original syllable count and to where the lips close (M, B, P), so the dub matches the mouth.'))), results);
  return { destroy() {} };
}
