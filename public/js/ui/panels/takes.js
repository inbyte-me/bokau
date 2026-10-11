import { h, clear, fmtClock } from '../../util.js';
import { t } from '../../i18n.js';
import { app } from '../../app.js';
import { applyTake } from '../../audio/session.js';

export function mountTakes(root) {
  const body = h('div.col#takes-list'); root.append(body);
  function render() {
    clear(body); const tr = app.track; if (!tr) return;
    body.append(h('div.hint', `${t('Takes on')} “${tr.name}” — ${t('click “Use” to put a take on the timeline (it replaces what is there). Nothing is ever deleted from disk.')}`));
    if (!tr.takes.length) body.append(h('div.empty', { style: { padding: '1rem' } }, t('No takes yet. Press ⏺ to record.')));
    for (const k of [...tr.takes].reverse()) {
      const active = tr.clips.some((c) => c.takeId === k.id || c.file === k.file);
      body.append(h('div.take' + (active ? '.active' : ''), { dataset: { take: k.id } },
        h('div.grow', h('div', k.label || t('Take')), h('div.small.dim.mono', `${fmtClock(k.start, { ms: true })} · ${k.duration.toFixed(1)}s${k.latencyMs ? ` · −${k.latencyMs}ms` : ''}`)),
        h('button.icon', { title: t('Audition'), onclick: () => { app.engine.playRange(Math.max(0, k.start - 0.3), k.start + k.duration + 0.2, { include: { original: true, voices: false, ghost: false } }); auditionTake(k); } }, '▶'),
        h('button.use', { onclick: () => { applyTake(app.store, tr.id, k.id); app.engine.refresh(); } }, active ? '✓ ' + t('Active') : t('Use')),
        h('button.ghost', { title: t('Remove from list'), onclick: () => { app.store.commit('Remove take', () => { tr.takes = tr.takes.filter((x) => x.id !== k.id); }, ['tracks']); } }, '✕')));
    }
  }
  // audition plays the take alone (without touching the track clips) over the original
  function auditionTake(k) {
    const ctx = app.engine.ctx; const buf = app.engine.assets.takes.get(k.file); if (!buf) return;
    const when = app.engine.anchor; const src = ctx.createBufferSource(); src.buffer = buf; const g = ctx.createGain(); g.gain.value = 1;
    src.connect(g); g.connect(app.engine.out); src.start(Math.max(ctx.currentTime, when + (k.start - Math.max(0, k.start - 0.3))));
  }
  render();
  const offs = [app.store.on('change', (kk) => (kk.has('tracks') || kk.has('all')) && render()), app.on('selection', render)];
  return { destroy: () => offs.forEach((f) => f()) };
}
