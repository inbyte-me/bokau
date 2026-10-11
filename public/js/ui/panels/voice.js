import { h, clear, toast, clamp } from '../../util.js';
import { t } from '../../i18n.js';
import { app } from '../../app.js';
import { api } from '../../api.js';
import { Mic } from '../../audio/mic.js';
import { FX_INFO } from '../../audio/fx.js';
import { calibrateLatency } from '../../audio/calibrate.js';

const ADVICE = {
  good: ['ok', 'Your mic level and noise floor look good. 👍'],
  silent: ['bad', 'Nothing came through. Check the mic/interface is plugged in, the right input is selected, and the gain knob on the interface is up.'],
  clipping: ['bad', 'Too loud — it is clipping. Turn the gain knob on the interface down (or the trim slider here) and stay ~15 cm from the mic.'],
  'too-quiet': ['warn', 'Very quiet. Raise the interface gain knob first (best), then the trim slider here.'],
  quiet: ['warn', 'A bit quiet. Raise the gain a little; use the suggested trim below.'],
  noisy: ['warn', 'Background noise is high. Move closer to the mic, turn off fans, and enable "Clean up" on the track.'],
  'low-snr': ['warn', 'Voice is not much louder than the noise. Get closer to the mic or add trim.'],
};

export function mountVoice(root) {
  const p = () => app.project; const mic = app.mic; const s = () => p().settings;
  const meterFill = h('i'); const peakTick = h('b'); const meter = h('div.meter.big#mic-meter', meterFill, peakTick);
  const meterTxt = h('div.small.mono.dim#mic-db', '— dB');
  const inSel = h('select#mic-device'); const outSel = h('select#out-device'); const chSel = h('select#mic-channel', ...[['auto', t('Auto')], ['left', t('Input 1 / Left')], ['right', t('Input 2 / Right')], ['mix', t('Mix both')]].map(([v, l]) => h('option', { value: v }, l)));
  const info = h('div.hint#mic-info'); const hint = h('div.hint.warn#no-interface-hint');
  let peakHold = 0;

  async function fillDevices() {
    const d = await Mic.devices();
    clear(inSel); clear(outSel);
    for (const i of d.inputs) inSel.append(h('option', { value: i.deviceId, selected: i.deviceId === mic.settings.deviceId }, i.label || t('Microphone') + ' ' + i.deviceId.slice(0, 4)));
    for (const o of d.outputs) outSel.append(h('option', { value: o.deviceId }, o.label || t('Output') + ' ' + o.deviceId.slice(0, 4)));
    if (!d.labelled) info.textContent = t('Click "Open mic" to allow microphone access — device names appear after that.');
    else {
      const external = d.inputs.filter((i) => !/built-in|integrad|virtual|zoom|predeterminado|default/i.test(i.label));
      hint.textContent = external.length ? '' : t('Only built-in or virtual inputs are visible. If you expected a USB audio interface, check that its cable carries data (not charge-only), try another port, then press Rescan.');
    }
  }
  navigator.mediaDevices?.addEventListener?.('devicechange', fillDevices);

  async function openMic() {
    try {
      await app.engine.init(); await app.engine.resume();
      const i = await mic.open({ deviceId: inSel.value || 'default', channel: chSel.value, gainDb: +gain.value });
      await fillDevices();
      info.textContent = `${i.label} · ${i.channelCount || '?'} ch · ${Math.round((i.sampleRate || 48000) / 1000)} kHz${i.channelCount > 1 ? '' : ' · ' + t('mono input')}`;
      chSel.disabled = (i.channelCount || 1) < 2; openBtn.textContent = '🎙 ' + t('Mic open'); openBtn.classList.add('on');
      app.emit('mic', true);
    } catch (e) { toast(t('Microphone error: {m}', { m: e.message }), 'error'); info.textContent = e.message; }
  }
  const openBtn = h('button.primary#mic-open', { onclick: openMic }, '🎙 ' + t('Open mic'));
  const gain = h('input#mic-gain', { type: 'range', min: -12, max: 36, step: 0.5, value: mic.settings.gainDb, oninput: (e) => { mic.setGainDb(+e.target.value); gv.textContent = `${e.target.value >= 0 ? '+' : ''}${e.target.value} dB`; } });
  const gv = h('span.v', `${mic.settings.gainDb >= 0 ? '+' : ''}${mic.settings.gainDb} dB`);
  inSel.onchange = () => mic.isOpen && openMic(); chSel.onchange = () => mic.setChannel(chSel.value);
  outSel.onchange = async () => { try { await app.engine.setOutputDevice(outSel.value); toast(t('Output switched'), 'ok'); } catch (e) { toast(e.message, 'error'); } };

  const offs = [mic.on('level', (l) => {
    const db = Math.max(-60, l.peakDb); const f = clamp((db + 60) / 60, 0, 1); meterFill.style.width = `${f * 100}%`;
    peakHold = Math.max(f, peakHold - 0.01); peakTick.style.left = `${peakHold * 100}%`;
    meterTxt.textContent = `${l.peakDb > -90 ? l.peakDb.toFixed(1) : '-∞'} dB peak · ${l.rmsDb > -90 ? l.rmsDb.toFixed(0) : '-∞'} dB rms${l.clipped ? ' · CLIP!' : ''}`; meterTxt.style.color = l.clipped ? 'var(--rec)' : '';
  })];

  // ---- mic check wizard ----
  const checkOut = h('div.col#mic-check-out');
  const checkBtn = h('button#mic-check', { onclick: async () => {
    if (!mic.isOpen) await openMic(); if (!mic.isOpen) return;
    checkBtn.disabled = true; clear(checkOut);
    const say = (m) => { clear(checkOut); checkOut.append(h('div.hint', m)); };
    try {
      const r = await mic.check({ onPhase: (ph) => say(ph === 'silence' ? '🤫 ' + t('Stay quiet for 2 seconds…') : '🗣 ' + t('Now speak normally for 3 seconds (e.g. "testing one two three")…')) });
      clear(checkOut);
      for (const a of r.advice) { const [k, msg] = ADVICE[a]; checkOut.append(h('div.hint' + (k === 'ok' ? '' : '.warn'), (k === 'ok' ? '✅ ' : '⚠️ ') + t(msg))); }
      checkOut.append(h('div.small.mono.dim', `${t('noise floor')} ${r.noiseDb.toFixed(0)} dB · ${t('speech')} ${r.speechDb.toFixed(0)} dB · ${t('peak')} ${r.peakDb.toFixed(0)} dB · SNR ${r.snr.toFixed(0)} dB`));
      if (Math.abs(r.suggestedGainDb) > 2 && r.peak !== 0 && !r.advice.includes('silent')) checkOut.append(h('button#apply-trim', { onclick: () => { const v = clamp(Math.round((mic.settings.gainDb + r.suggestedGainDb) * 2) / 2, -12, 36); gain.value = v; gain.oninput({ target: gain }); toast(t('Trim set to {v} dB', { v }), 'ok'); } }, t('Apply suggested trim ({v} dB)', { v: `${r.suggestedGainDb > 0 ? '+' : ''}${r.suggestedGainDb.toFixed(0)}` })));
    } catch (e) { say(e.message); } finally { checkBtn.disabled = false; }
  } }, '🩺 ' + t('Mic check'));

  // ---- latency ----
  const latNum = h('span.v#lat-val', `${p().latencyMs} ms`);
  const latency = h('input#latency', { type: 'range', min: 0, max: 600, step: 1, value: p().latencyMs, oninput: (e) => { app.store.silent((pr) => { pr.latencyMs = +e.target.value; }, ['settings']); latNum.textContent = `${e.target.value} ms`; }, onchange: () => app.store.commit('Latency', () => {}, ['settings'], { merge: true }) });
  const calOut = h('div.hint#cal-out');
  const calBtn = h('button#calibrate', { onclick: async () => {
    if (!mic.isOpen) await openMic(); if (!mic.isOpen) return;
    calBtn.disabled = true; calOut.textContent = t('Playing test clicks… keep the room quiet. The mic must be able to hear the speakers/headphones.');
    try {
      const r = await calibrateLatency(app.engine, mic);
      if (r.ms == null || !r.ok) calOut.textContent = t('Could not hear the clicks reliably. Turn the volume up, put the headphones next to the mic (or use speakers) and try again.');
      else { const ms = Math.round(r.ms); latency.value = ms; latency.oninput({ target: latency }); app.store.commit('Latency', () => {}, ['settings']); calOut.textContent = `✅ ${t('Measured round-trip latency: {ms} ms (applied).', { ms })}`; }
    } catch (e) { calOut.textContent = e.message; } finally { calBtn.disabled = false; }
  } }, '⏱ ' + t('Auto-calibrate'));

  // ---- track fx ----
  const fxBox = h('div.box#fx-box');
  function renderFx() {
    clear(fxBox); const tr = app.track; if (!tr) return;
    const set = (k, v, refresh = true) => { app.store.commit('Voice setting', () => { tr[k] = v; }, ['tracks']); if (refresh) app.engine.refresh(); };
    fxBox.append(h('h4', `${t('Voice effect')} — ${tr.name}`),
      h('div.fxgrid', ...Object.entries(FX_INFO).map(([k, v]) => h('button.fxbtn' + (tr.fx === k ? '.sel' : ''), { dataset: { fx: k }, onclick: () => set('fx', k) }, h('span.e', v.emoji), t(v.label)))),
      h('div.slider', t('Effect amount'), h('input#fx-amount', { type: 'range', min: 0, max: 1, step: 0.01, value: tr.fxAmount, disabled: tr.fx === 'none', onchange: (e) => set('fxAmount', +e.target.value) }), h('span.v', `${Math.round(tr.fxAmount * 100)}%`)),
      h('label.row.small', h('input#micfix', { type: 'checkbox', checked: tr.micFix, onchange: (e) => set('micFix', e.target.checked) }), t('Mic fix: rumble filter + gentle leveling (great for budget mics)')),
      h('div.slider', t('Micro-nudge'), h('input#nudge', { type: 'range', min: -250, max: 250, step: 1, value: tr.nudgeMs, oninput: (e) => { tr.nudgeMs = +e.target.value; e.target.nextSibling.textContent = `${e.target.value} ms`; app.store.silent(() => {}, ['tracks']); }, onchange: () => { app.store.commit('Nudge track', () => {}, ['tracks'], { merge: true }); app.engine.refresh(); } }), h('span.v', `${tr.nudgeMs} ms`)),
      h('div.hint', t('Nudge shifts this whole track earlier (−) or later (+) after recording — fix small sync errors by ear.')));
    const clip = tr.clips.find((c) => c.id === app.sel.clipId);
    if (clip) fxBox.append(h('div.row', h('button#clean-take', { onclick: cleanClip(tr, clip) }, '🧹 ' + t('Denoise this clip (server)')), h('div.slider', { style: { flex: 1 } }, t('Clip gain'), h('input', { type: 'range', min: 0, max: 3, step: 0.01, value: clip.gain ?? 1, onchange: (e) => { app.store.commit('Clip gain', () => { clip.gain = +e.target.value; }, ['tracks']); app.engine.refresh(); } }), h('span.v', `${(clip.gain ?? 1).toFixed(2)}×`))));
  }
  function cleanClip(tr, clip) { return async () => {
    try {
      await app.session.flushUploads(); toast(t('Cleaning…'));
      const r = await api.post(`/api/projects/${app.project.id}/takes/${clip.file}/clean`);
      const buf = await (async () => { const rr = await fetch(`/media/${app.project.id}/takes/${r.name}`); return app.engine.ctx.decodeAudioData(await rr.arrayBuffer()); })();
      app.engine.assets.addTake(r.name, buf);
      app.store.commit('Denoise clip', () => { clip.file = r.name; }, ['tracks']); app.engine.refresh(); toast(t('Clip cleaned (+{g} dB makeup)', { g: r.gainDb.toFixed(1) }), 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }; }

  const outRadio = (v, label) => h('label.row.small', h('input', { type: 'radio', name: 'outtype', value: v, checked: s().output === v, onchange: () => { app.store.commit('Output type', (pr) => { pr.settings.output = v; if (v === 'speakers') pr.settings.muteOriginalWhileRecording = true; }, ['settings']); renderRec(); } }), label);
  const recBox = h('div.box#rec-box');
  function renderRec() {
    clear(recBox); const st = s();
    recBox.append(h('h4', t('Recording setup')),
      h('div.row', outRadio('headphones', '🎧 ' + t('Headphones')), outRadio('speakers', '📺 ' + t('TV / speakers'))),
      st.output === 'speakers' ? h('div.hint.warn', t('On speakers the mic hears the video sound. The original audio is muted while recording (you will still see the cues and picture). Use headphones for ghost-guide and music beds.')) : h('div.hint', t('Headphones: no bleed into the mic, so you can hear the original or the ghost guide while recording.')),
      h('div.slider', t('Count-in'), h('input#preroll', { type: 'range', min: 0, max: 5, step: 1, value: st.preRoll, onchange: (e) => { app.store.commit('Pre-roll', (pr) => { pr.settings.preRoll = +e.target.value; }, ['settings']); renderRec(); } }), h('span.v', st.preRoll ? `${st.preRoll} s` : t('off'))),
      h('label.row.small', h('input#beep', { type: 'checkbox', checked: st.preRollBeep, onchange: (e) => app.store.commit('Beep', (pr) => { pr.settings.preRollBeep = e.target.checked; }, ['settings']) }), t('Audible 3-2-1-BEEP')),
      h('label.row.small', h('input#mute-orig-rec', { type: 'checkbox', checked: st.muteOriginalWhileRecording, onchange: (e) => app.store.commit('Mute original', (pr) => { pr.settings.muteOriginalWhileRecording = e.target.checked; }, ['settings']) }), t('Mute original audio while recording')),
      h('label.row.small', h('input#monitor', { type: 'checkbox', checked: mic.settings.monitor, onchange: (e) => mic.setMonitor(e.target.checked, +mic.settings.monitorPan) }), t('Hear myself (headphones only!)')),
      h('label.row.small', h('input#aec', { type: 'checkbox', checked: mic.settings.aec, onchange: (e) => { mic.settings.aec = e.target.checked; mic.isOpen && openMic(); } }), t('Echo cancellation (for speakers; slightly degrades the voice)')));
  }

  root.append(
    h('div.box', h('h4', t('Microphone / audio interface')), h('div.field', h('label', t('Input device')), h('div.row', inSel, h('button.icon#rescan', { title: t('Rescan devices'), onclick: fillDevices }, '🔄'))), hint, h('div.field', h('label', t('Interface channel')), chSel),
      h('div.slider', t('Input trim'), gain, gv), meter, meterTxt, info, h('div.row', openBtn, checkBtn), checkOut,
      h('div.field', h('label', t('Output device (headphones / TV)')), outSel)),
    recBox,
    h('div.box', h('h4', t('Latency compensation')), h('div.slider', t('Round trip'), latency, latNum), h('div.row', calBtn), calOut,
      h('div.hint', t('Recorded clips are placed earlier by this amount so your voice lines up with what you saw and heard. USB interfaces ≈ 15–40 ms, Bluetooth headphones 150–300 ms.'))),
    fxBox);
  renderRec(); renderFx(); fillDevices();
  offs.push(app.on('selection', renderFx), app.store.on('change', (k) => { if (k.has('tracks') || k.has('all')) renderFx(); }));
  return { destroy: () => { offs.forEach((f) => f()); navigator.mediaDevices?.removeEventListener?.('devicechange', fillDevices); } };
}
