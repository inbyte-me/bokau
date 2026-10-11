import { h, clear, toast } from '../../util.js';
import { t } from '../../i18n.js';
import { icon } from '../../icons.js';
import { app } from '../../app.js';
import { api } from '../../api.js';
import { rmsEnvelope } from '../../audio/peaks.js';
import { detectFlaps } from '../../audio/flaps.js';
import { identifySpeakers } from '../../speakers/identify.js';
import { dominantSpeaker } from '/shared/diarize.js';

const slider = (label, id, { min, max, step, value, fmt = (v) => v, onInput, onChange }) => {
  const v = h('span.v', fmt(value));
  return h('div.slider', label, h('input', { id, type: 'range', min, max, step, value, oninput: (e) => { v.textContent = fmt(+e.target.value); onInput?.(+e.target.value); }, onchange: (e) => onChange?.(+e.target.value) }), v);
};

export function mountMix(root, { band, stage }) {
  const body = h('div.col'); root.append(body);
  let neural = false; api.system().then((sy) => { if (sy.neuralSeparation !== neural) { neural = !!sy.neuralSeparation; render(); } }).catch(() => {});
  function render() {
    clear(body); const p = app.project; const stems = p.stems; const ready = stems?.status === 'ready';
    const stemStatus = h('div.hint#stem-status');
    const runStems = async (method, btn) => {
      btn.disabled = true; const t0 = Date.now(); stemStatus.textContent = t('Separating…');
      try {
        const job = (await api.post(`/api/projects/${p.id}/stems`, { method })).job;
        await api.waitJob(job, (j) => { stemStatus.textContent = `${j.message || t('Separating')} ${Math.round(j.progress * 100)}% · ${Math.round((Date.now() - t0) / 1000)} s`; }, { intervalMs: 800 });
        const fresh = await api.project(p.id); app.store.refreshServerParts(fresh);
        if (fresh.stems.status === 'ready') { await app.engine.assets.loadStems(); app.store.commit('Stems', (pr) => { pr.original.source = 'bg'; }, ['levels']); toast(t('Stems ready: dialogue muted, music + SFX kept'), 'ok'); app.engine.refresh(); }
        else toast(fresh.stems.neuralAvailable ? t('This clip is mono, so phase separation cannot split it. Use “Best quality (neural)”.') : t('This clip is mono. Install the neural separator (npm run setup:separation) or use ducking.'), 'error', 7000);
      } catch (e) { toast(e.message, 'error', 8000); } finally { render(); }
    };
    const fastBtn = h('button#stems-go', { onclick: () => runStems('auto', fastBtn) }, icon('wave'), ready ? t('Re-separate') : t('Separate dialogue / music'));
    const neuralBtn = h('button#stems-neural', { disabled: !neural, title: neural ? '' : t('Not installed. Run: npm run setup:separation'), onclick: () => runStems('neural', neuralBtn) }, icon('wave'), t('Best quality (neural)'));
    const sepBtn = h('div.row', fastBtn, neuralBtn);
    body.append(
      h('div.box', h('h4', t('Original audio')), slider(t('Volume'), 'orig-vol', { min: 0, max: 1.5, step: 0.01, value: p.original.volume, fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { p.original.volume = v; app.engine.applyLevels(); }, onChange: () => app.store.commit('Original volume', () => {}, ['levels']) }),
        h('div.field', h('label', t('Play')), h('select#orig-source', { disabled: !ready, onchange: (e) => { app.store.commit('Original source', (pr) => { pr.original.source = e.target.value; }, ['levels']); app.engine.refresh(); } },
          ...[['full', t('Full mix')], ['bg', t('Music + SFX only (actors silenced)')], ['dialogue', t('Dialogue only')]].map(([v, l]) => h('option', { value: v, selected: p.original.source === v }, l)))),
        sepBtn, stemStatus,
        ready ? h('div.hint', `${t('Stems ready')} (${stems.method === 'surround-center' ? t('from the 5.1 centre channel — clean') : stems.method === 'neural-demucs' ? t('neural separation (Demucs)') : t('centre-channel extraction — good for dialogue panned to the middle, imperfect on busy mixes')})`)
          : stems?.status === 'unsupported' ? h('div.hint.warn', neural ? t('This clip is mono, so phase separation cannot split it. Use “Best quality (neural)”: it takes about as long as the clip.') : t('This clip is mono. Install the neural separator (npm run setup:separation) or use the volume and ducking controls.')) : h('div.hint', t('Splits the clip audio into Original Dialogue and Background (music + sound effects) so you can silence the actors but keep the score, gunshots and ambience. “Best quality (neural)” also works on mono clips, takes about as long as the clip, and runs on this computer.'))),
      voicesBox(p, ready),
      h('div.box', h('h4', t('Auto-ducking')), h('label.row', h('input#duck-on', { type: 'checkbox', checked: p.ducking.enabled, onchange: (e) => { app.store.commit('Ducking', (pr) => { pr.ducking.enabled = e.target.checked; }, ['levels']); app.engine.refresh(); } }), t('Lower the background when I speak')),
        slider(t('Reduction'), 'duck-db', { min: -30, max: -3, step: 1, value: p.ducking.db, fmt: (v) => `${v} dB`, onChange: (v) => { app.store.commit('Ducking depth', (pr) => { pr.ducking.db = v; }, ['levels']); app.engine.refresh(); } }),
        slider(t('Attack'), 'duck-atk', { min: 0.01, max: 0.3, step: 0.01, value: p.ducking.attack, fmt: (v) => `${Math.round(v * 1000)} ms`, onChange: (v) => { app.store.commit('Ducking attack', (pr) => { pr.ducking.attack = v; }, ['levels']); app.engine.refresh(); } }),
        slider(t('Release'), 'duck-rel', { min: 0.05, max: 1.5, step: 0.05, value: p.ducking.release, fmt: (v) => `${Math.round(v * 1000)} ms`, onChange: (v) => { app.store.commit('Ducking release', (pr) => { pr.ducking.release = v; }, ['levels']); app.engine.refresh(); } }),
        h('div.hint', t('The green line on the original-audio lane shows the ducking envelope.'))),
      h('div.box', h('h4', t('Ghost audio guide')), h('label.row', h('input#ghost-on', { type: 'checkbox', checked: p.original.ghost.enabled, onchange: (e) => { app.store.commit('Ghost guide', (pr) => { pr.original.ghost.enabled = e.target.checked; }, ['levels']); app.engine.refresh(); } }), t('Play the original dialogue in my headphones')),
        slider(t('Level'), 'ghost-level', { min: 0, max: 1, step: 0.01, value: p.original.ghost.level, fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { p.original.ghost.level = v; app.engine.applyLevels(); }, onChange: () => app.store.commit('Ghost level', () => {}, ['levels']) }),
        h('div.field', h('label', t('Ear')), h('select#ghost-pan', { onchange: (e) => { app.store.commit('Ghost pan', (pr) => { pr.original.ghost.pan = +e.target.value; }, ['levels']); app.engine.applyLevels(); } }, ...[[-1, t('Left ear only')], [1, t('Right ear only')], [0, t('Both ears')]].map(([v, l]) => h('option', { value: v, selected: p.original.ghost.pan === v }, l)))),
        h('div.hint', t('Headphones only. The guide is never part of the export. With separated stems the music bed plays normally and the dialogue is the ghost.'))),
      h('div.box', h('h4', t('Lip-flap markers')), h('div.row', h('button#flaps-auto', { onclick: autoFlaps }, icon('wave'), t('Auto-detect from dialogue')), h('button#flaps-clear', { onclick: () => app.store.commit('Clear flaps', (pr) => { pr.lipFlaps = []; }, ['flaps']) }, t('Clear'))),
        h('div.hint', t('Manual: hold the M key while the character\'s mouth is open (while playing). Or drag in the Lip flaps lane. Pink bars show when to speak; red line = now.'))),
      h('div.box', h('h4', t('Display')), slider(t('Band speed'), 'band-speed', { min: 80, max: 420, step: 10, value: band.pps, fmt: (v) => `${v} px/s`, onInput: (v) => band.setSpeed(v) }),
        h('label.row', h('input#banner-on', { type: 'checkbox', checked: localStorage.getItem('banner') !== '0', onchange: (e) => { localStorage.setItem('banner', e.target.checked ? '1' : '0'); stage.showBanner(e.target.checked); } }), t('Show karaoke subtitles on the video')),
        slider(t('Picture delay'), 'av-offset', { min: -200, max: 400, step: 5, value: Math.round(app.engine.avOffset * 1000), fmt: (v) => `${v} ms`, onInput: (v) => { app.engine.avOffset = v / 1000; } }),
        h('div.hint', t('If the TV adds lag (HDMI/Bluetooth), nudge the picture delay until lips match the sound.'))));
  }
  function voicesBox(p, ready) {
    const spk = p.speakers || { list: [], segments: [] }; const status = h('div.hint#voices-status');
    const identify = h('button#voices-go', { disabled: !ready, onclick: async () => {
      identify.disabled = true; status.textContent = t('Starting…');
      try {
        const count = Number(localStorage.getItem('voiceCount')) || null; const r = await identifySpeakers(app.project, { count, nameFor: (i) => `${t('Character')} ${'ABCDEFGHIJ'[i]}`, onProgress: (e) => { status.textContent = e.type === 'progress' ? (e.stage === 'download' ? `${t('Downloading model')} ${Math.round(e.pct * 100)}%` : `${t('Analysing voices')} ${Math.round(e.pct * 100)}%`) : t('Analysing voices'); } });
        app.store.commit('Identify voices', (pr) => {
          pr.speakers = { list: r.speakers, segments: r.segments };
          for (const c of pr.cues) { if (c.character) continue; const sid = dominantSpeaker(r.segments, c.start, c.end); const sp = r.speakers.find((x) => x.id === sid); if (sp) c.character = sp.name; }
        }, ['speakers', 'cues', 'tracks']);
        toast(t('{n} voices found', { n: r.speakers.length }), 'ok'); app.engine.refresh();
      } catch (e) { toast(e.message, 'error'); } finally { render(); }
    } }, icon('mic'), spk.list.length ? t('Identify again') : t('Identify voices'));
    const dur = (id) => spk.segments.filter((g) => g.speaker === id).reduce((a, g) => a + g.end - g.start, 0);
    const set = (sp, patch) => { app.store.commit('Voice setting', () => Object.assign(sp, patch), ['speakers']); app.engine.refresh(); };
    const rows = spk.list.map((sp) => h('div.row.voice-row', { dataset: { speaker: sp.id } },
      h('span.swatch', { style: { background: sp.color, width: '.8em', height: '.8em' } }),
      h('input.grow', { type: 'text', value: sp.name, 'aria-label': t('Character name'), onchange: (e) => { const old = sp.name; app.store.commit('Rename voice', (pr) => { const x = pr.speakers.list.find((q) => q.id === sp.id); x.name = e.target.value || old; for (const c of pr.cues) if (c.character === old) c.character = x.name; }, ['speakers', 'cues']); } }),
      h('span.small.dim.mono', `${Math.round(dur(sp.id))} s`),
      h('button.voice-mute' + (sp.muted ? '.on' : ''), { title: t('Silence this character in the original audio, so you can dub it'), onclick: () => set(sp, { muted: !sp.muted }) }, sp.muted ? t('Off') : t('On')),
      h('button.voice-solo' + (sp.solo ? '.on' : ''), { title: t('Hear only this character'), onclick: () => set(sp, { solo: !sp.solo }) }, 'S'),
      h('button.icon', { title: t('Listen to this character'), onclick: () => { const g = spk.segments.find((x) => x.speaker === sp.id); if (g) app.engine.playRange(Math.max(0, g.start - 0.2), Math.min(g.end + 0.2, g.start + 6)); } }, icon('play', 13))));
    const seg = spk.segments[app.sel.segIdx];
    const reassign = seg ? h('div.row', h('span.small.dim', `${t('Selected passage')} ${seg.start.toFixed(1)}–${seg.end.toFixed(1)} s`), h('select#seg-assign', { onchange: (e) => { app.store.commit('Reassign passage', (pr) => { pr.speakers.segments[app.sel.segIdx].speaker = e.target.value; }, ['speakers']); app.engine.refresh(); } }, ...spk.list.map((sp) => h('option', { value: sp.id, selected: sp.id === seg.speaker }, sp.name)))) : null;
    const countSel = h('select#voice-count', { title: t('Number of voices'), onchange: (e) => localStorage.setItem('voiceCount', e.target.value) }, h('option', { value: '' }, t('Auto')), ...[1, 2, 3, 4, 5, 6].map((n) => h('option', { value: n, selected: String(n) === (localStorage.getItem('voiceCount') || '') }, `${n} ${t(n === 1 ? 'voice' : 'voices')}`)));
    return h('div.box#voices-box', h('h4', t('Voices (who is speaking)')), h('div.row', identify, countSel), status,
      !ready ? h('div.hint', t('Separate the dialogue first: voices are identified on the clean dialogue track.')) : null,
      spk.list.length ? h('div.col', ...rows, reassign, h('div.hint', t('Turn a character Off to hear the clip without that voice, then record your own over it. Click a coloured block in the Voices lane to check or correct who is speaking.'))) : (ready ? h('div.hint', t('Finds each distinct voice in the clip so you can silence one character at a time. Runs on this computer.')) : null));
  }

  async function autoFlaps() {
    const A = app.engine.assets; const buf = A.dialogue || A.orig; if (!buf) return;
    const flaps = detectFlaps(rmsEnvelope(buf, 100));
    if (!flaps.length) return toast(t('No speech found to derive mouth movements from'), 'error');
    app.store.commit('Auto lip flaps', (pr) => { pr.lipFlaps = flaps; }, ['flaps']); toast(t('{n} mouth-open markers', { n: flaps.length }) + (A.dialogue ? '' : ' · ' + t('tip: separate dialogue first for a cleaner result')), 'ok');
  }
  render();
  const off = [app.store.on('change', (k) => { if (k.has('media') || k.has('all') || k.has('speakers')) render(); }), app.on('selection', () => { if (app.project.speakers?.segments?.length) render(); })];
  return { destroy: () => off.forEach((f) => f()) };
}
