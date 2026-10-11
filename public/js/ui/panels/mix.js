import { h, clear, toast } from '../../util.js';
import { t } from '../../i18n.js';
import { app } from '../../app.js';
import { api } from '../../api.js';
import { rmsEnvelope } from '../../audio/peaks.js';
import { detectFlaps } from '../../audio/flaps.js';

const slider = (label, id, { min, max, step, value, fmt = (v) => v, onInput, onChange }) => {
  const v = h('span.v', fmt(value));
  return h('div.slider', label, h('input', { id, type: 'range', min, max, step, value, oninput: (e) => { v.textContent = fmt(+e.target.value); onInput?.(+e.target.value); }, onchange: (e) => onChange?.(+e.target.value) }), v);
};

export function mountMix(root, { band, stage }) {
  const body = h('div.col'); root.append(body);
  function render() {
    clear(body); const p = app.project; const stems = p.stems; const ready = stems?.status === 'ready';
    const stemStatus = h('div.hint#stem-status');
    const sepBtn = h('button.primary#stems-go', { onclick: async () => {
      sepBtn.disabled = true; stemStatus.textContent = t('Separating… (a few seconds per minute of video)');
      try {
        const job = (await api.post(`/api/projects/${p.id}/stems`)).job; await api.waitJob(job, (j) => { stemStatus.textContent = `${t('Separating')} ${Math.round(j.progress * 100)}%`; });
        const fresh = await api.project(p.id); app.store.refreshServerParts(fresh);
        if (fresh.stems.status === 'ready') { await app.engine.assets.loadStems(); app.store.commit('Stems', (pr) => { pr.original.source = 'bg'; }, ['levels']); toast(t('Stems ready: dialogue muted, music + SFX kept'), 'ok'); app.engine.refresh(); }
        else toast(t('This clip is mono — voice and music cannot be separated by phase. Use ducking instead.'), 'error', 6000);
      } catch (e) { toast(e.message, 'error'); } finally { render(); }
    } }, '✂ ' + (ready ? t('Re-separate') : t('Separate dialogue / music')));
    body.append(
      h('div.box', h('h4', t('Original audio')), slider(t('Volume'), 'orig-vol', { min: 0, max: 1.5, step: 0.01, value: p.original.volume, fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { p.original.volume = v; app.engine.applyLevels(); }, onChange: () => app.store.commit('Original volume', () => {}, ['levels']) }),
        h('div.field', h('label', t('Play')), h('select#orig-source', { disabled: !ready, onchange: (e) => { app.store.commit('Original source', (pr) => { pr.original.source = e.target.value; }, ['levels']); app.engine.refresh(); } },
          ...[['full', t('Full mix')], ['bg', t('Music + SFX only (actors silenced)')], ['dialogue', t('Dialogue only')]].map(([v, l]) => h('option', { value: v, selected: p.original.source === v }, l)))),
        sepBtn, stemStatus,
        ready ? h('div.hint', `✅ ${t('Stems ready')} (${stems.method === 'surround-center' ? t('from the 5.1 centre channel — clean') : t('centre-channel extraction — good for dialogue panned to the middle, imperfect on busy mixes')})`)
          : stems?.status === 'unsupported' ? h('div.hint.warn', t('Mono audio can\'t be separated this way. Use the volume and ducking controls instead.')) : h('div.hint', t('Splits the clip audio into Original Dialogue and Background (music + sound effects) so you can silence the actors but keep the score, gunshots and ambience.'))),
      h('div.box', h('h4', t('Auto-ducking')), h('label.row', h('input#duck-on', { type: 'checkbox', checked: p.ducking.enabled, onchange: (e) => { app.store.commit('Ducking', (pr) => { pr.ducking.enabled = e.target.checked; }, ['levels']); app.engine.refresh(); } }), t('Lower the background when I speak')),
        slider(t('Reduction'), 'duck-db', { min: -30, max: -3, step: 1, value: p.ducking.db, fmt: (v) => `${v} dB`, onChange: (v) => { app.store.commit('Ducking depth', (pr) => { pr.ducking.db = v; }, ['levels']); app.engine.refresh(); } }),
        slider(t('Attack'), 'duck-atk', { min: 0.01, max: 0.3, step: 0.01, value: p.ducking.attack, fmt: (v) => `${Math.round(v * 1000)} ms`, onChange: (v) => { app.store.commit('Ducking attack', (pr) => { pr.ducking.attack = v; }, ['levels']); app.engine.refresh(); } }),
        slider(t('Release'), 'duck-rel', { min: 0.05, max: 1.5, step: 0.05, value: p.ducking.release, fmt: (v) => `${Math.round(v * 1000)} ms`, onChange: (v) => { app.store.commit('Ducking release', (pr) => { pr.ducking.release = v; }, ['levels']); app.engine.refresh(); } }),
        h('div.hint', t('The green line on the original-audio lane shows the ducking envelope.'))),
      h('div.box', h('h4', t('Ghost audio guide')), h('label.row', h('input#ghost-on', { type: 'checkbox', checked: p.original.ghost.enabled, onchange: (e) => { app.store.commit('Ghost guide', (pr) => { pr.original.ghost.enabled = e.target.checked; }, ['levels']); app.engine.refresh(); } }), t('Play the original dialogue in my headphones')),
        slider(t('Level'), 'ghost-level', { min: 0, max: 1, step: 0.01, value: p.original.ghost.level, fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { p.original.ghost.level = v; app.engine.applyLevels(); }, onChange: () => app.store.commit('Ghost level', () => {}, ['levels']) }),
        h('div.field', h('label', t('Ear')), h('select#ghost-pan', { onchange: (e) => { app.store.commit('Ghost pan', (pr) => { pr.original.ghost.pan = +e.target.value; }, ['levels']); app.engine.applyLevels(); } }, ...[[-1, t('Left ear only')], [1, t('Right ear only')], [0, t('Both ears')]].map(([v, l]) => h('option', { value: v, selected: p.original.ghost.pan === v }, l)))),
        h('div.hint', t('Headphones only. The guide is never part of the export. With separated stems the music bed plays normally and the dialogue is the ghost.'))),
      h('div.box', h('h4', t('Lip-flap markers')), h('div.row', h('button#flaps-auto', { onclick: autoFlaps }, '🤖 ' + t('Auto-detect from dialogue')), h('button#flaps-clear', { onclick: () => app.store.commit('Clear flaps', (pr) => { pr.lipFlaps = []; }, ['flaps']) }, t('Clear'))),
        h('div.hint', t('Manual: hold the M key while the character\'s mouth is open (while playing). Or drag in the Lip flaps lane. Pink bars show when to speak; red line = now.'))),
      h('div.box', h('h4', t('Display')), slider(t('Band speed'), 'band-speed', { min: 80, max: 420, step: 10, value: band.pps, fmt: (v) => `${v} px/s`, onInput: (v) => band.setSpeed(v) }),
        h('label.row', h('input#banner-on', { type: 'checkbox', checked: localStorage.getItem('banner') !== '0', onchange: (e) => { localStorage.setItem('banner', e.target.checked ? '1' : '0'); stage.showBanner(e.target.checked); } }), t('Show karaoke subtitles on the video')),
        slider(t('Picture delay'), 'av-offset', { min: -200, max: 400, step: 5, value: Math.round(app.engine.avOffset * 1000), fmt: (v) => `${v} ms`, onInput: (v) => { app.engine.avOffset = v / 1000; } }),
        h('div.hint', t('If the TV adds lag (HDMI/Bluetooth), nudge the picture delay until lips match the sound.'))));
  }
  async function autoFlaps() {
    const A = app.engine.assets; const buf = A.dialogue || A.orig; if (!buf) return;
    const flaps = detectFlaps(rmsEnvelope(buf, 100));
    if (!flaps.length) return toast(t('No speech found to derive mouth movements from'), 'error');
    app.store.commit('Auto lip flaps', (pr) => { pr.lipFlaps = flaps; }, ['flaps']); toast(t('{n} mouth-open markers', { n: flaps.length }) + (A.dialogue ? '' : ' · ' + t('tip: separate dialogue first for a cleaner result')), 'ok');
  }
  render();
  const off = app.store.on('change', (k) => { if (k.has('media') || k.has('all')) render(); });
  return { destroy: off };
}
