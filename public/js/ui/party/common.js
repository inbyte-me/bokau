import { h, clear, toast, clamp } from '../../util.js';
import { t } from '../../i18n.js';
import { app } from '../../app.js';
import { api } from '../../api.js';
import { newCue, newId, newTrack, pickColor } from '/shared/project.js';
import { segmentsToCues } from '/shared/transcribe.js';
import { transcribeProject } from '../../stt/client.js';
import { mountVoice } from '../panels/voice.js';
import { FX_INFO } from '../../audio/fx.js';

/** big modal with the full audio setup (mic, interface channel, headphones vs TV speakers, latency) */
export function audioSetupModal() {
  const back = h('div.modal-back', { onclick: (e) => e.target === back && close() }); const close = () => { m.destroy?.(); back.remove(); };
  const body = h('div.col'); const m = mountVoice(body);
  back.append(h('div.modal', h('h2', '🎧 ' + t('Audio setup')), body, h('div.actions', h('button.primary', { id: 'audio-setup-done', onclick: close }, t('Done')))));
  document.body.append(back); return { close };
}

/** compact "is everything ready" strip shown on every party setup screen */
export function readyStrip() {
  const meter = h('div.meter', { style: { width: '160px', height: '16px' } }, h('i'), h('b'));
  const chip = h('span.chip#party-mic-chip', app.mic.isOpen ? '🎙 ' + t('mic ready') : '🎙 ' + t('mic not open'));
  const el = h('div.row', { id: 'ready-strip' }, chip, meter, h('button#open-audio-setup', { onclick: audioSetupModal }, '⚙ ' + t('Audio setup')),
    h('span.small.dim', app.project.settings.output === 'speakers' ? '📺 ' + t('TV speakers: original sound is muted while you perform') : '🎧 ' + t('Headphones')));
  const off = app.mic.on('level', (l) => { meter.firstChild.style.width = `${clamp((Math.max(-60, l.peakDb) + 60) / 60, 0, 1) * 100}%`; chip.textContent = '🎙 ' + t('mic ready'); chip.className = 'chip ok'; });
  el.destroy = off; return el;
}
export async function ensureMic() {
  if (app.mic.isOpen) return true;
  try { await app.engine.init(); await app.engine.resume(); await app.mic.open({ deviceId: app.mic.settings.deviceId }); return true; }
  catch (e) { toast(t('Microphone error: {m}', { m: e.message }), 'error'); audioSetupModal(); return false; }
}

export function busyOverlay(text) {
  const label = h('div', { style: { fontSize: '1.4rem', fontWeight: 700 } }, text); const sub = h('div.dim', ''); const bar = h('i'); const prog = h('div.progress', { style: { width: '320px' } }, bar);
  const el = h('div.modal-back', { id: 'busy' }, h('div.modal', { style: { textAlign: 'center', width: 'min(520px,92vw)' } }, h('div', { style: { fontSize: '3rem' } }, '🎬'), label, prog, sub));
  document.body.append(el);
  return { set(t_, s, f) { if (t_) label.textContent = t_; if (s != null) sub.textContent = s; if (f != null) bar.style.width = `${f * 100}%`; }, close: () => el.remove() };
}

/** Get usable cues: existing ones, or transcribe the original dialogue with local Whisper. */
export async function ensureTranscript({ language = 'auto', model = 'Xenova/whisper-base', busy } = {}) {
  const p = app.project; if (p.cues.some((c) => c.text?.trim())) return p.cues;
  busy?.set(t('Listening to the clip…'), t('Speech recognition runs on this computer'), 0.05);
  const r = await transcribeProject(p, { model, language, onProgress: (e) => busy?.set(null, e.type === 'progress' ? `${t('Downloading model')} ${Math.round(e.pct * 100)}%` : t('Transcribing…'), e.type === 'progress' ? 0.05 + e.pct * 0.4 : 0.6) });
  if (!r.cues.length) throw new Error(t('No speech found in this clip. Try Bad Lip Reading, which does not need dialogue.'));
  app.store.commit('Transcribe', (pr) => { pr.cues = r.cues.map((c) => newCue({ start: c.start, end: c.end, text: c.text })); }, ['cues']);
  return app.project.cues;
}

/** slots for lines to write: transcript cues, else detected speech segments, else even chunks */
export async function makeSlots({ matchSounds, busy, language }) {
  const p = app.project; const dur = p.media.duration;
  if (p.cues.length) return p.cues.map((c) => ({ start: c.start, end: c.end, text: matchSounds ? c.text : '' }));
  if (matchSounds && p.media.hasAudio && dur <= 120) { try { const cues = await ensureTranscript({ language, busy }); return cues.map((c) => ({ start: c.start, end: c.end, text: c.text })); } catch (e) { console.warn('stt skipped', e.message); } }
  try {
    const { segments } = await api.post(`/api/projects/${p.id}/speech-segments`, {});
    const covered = segments.reduce((a, s) => a + (s.end - s.start), 0);
    if (segments.length >= 2 && covered < dur * 0.92) return segmentsToCues(segments, { maxSec: 5 });
  } catch {}
  const n = Math.max(1, Math.round(dur / 3.2)); return Array.from({ length: n }, (_, i) => ({ start: (dur * i) / n, end: (dur * (i + 1)) / n, text: '' }));
}

export function setScript(lines, slotsById) {
  app.store.commit('Party script', (p) => { p.cues = lines.map((l) => { const s = slotsById.get(l.id); return newCue({ id: l.id, start: s.start, end: s.end, text: l.text, character: l.character || '', direction: l.direction || '' }); }); }, ['cues']);
}

/** make sure there's a track for this performer */
export function ensureTrack(name, { fx = 'none', index } = {}) {
  let tr = app.project.tracks.find((x) => x.name === name);
  if (!tr) app.store.commit('Add performer', (p) => { tr = newTrack({ name, index: index ?? p.tracks.length, fx }); p.tracks.push(tr); }, ['tracks']);
  tr = app.project.tracks.find((x) => x.name === name); return tr;
}

export const RANDOM_FX = ['none', 'walkie', 'monster', 'helium', 'ghost'];

/** speaking-drama score 0..100 from mic RMS dynamics while performing */
export class DramaMeter {
  constructor(barEl) { this.bar = barEl; this.samples = []; this.smooth = 0; this.off = app.mic.on('level', (l) => { if (app.session.state !== 'recording') return; const db = Math.max(-70, l.rmsDb); this.samples.push(db); const v = clamp((db + 55) / 40, 0, 1); this.smooth += (v - this.smooth) * 0.35; this.bar.style.width = `${this.smooth * 100}%`; }); }
  score() {
    if (this.samples.length < 20) return 0; const s = [...this.samples].sort((a, b) => a - b); const q = (f) => s[Math.floor(s.length * f)];
    const range = q(0.95) - q(0.15), loud = q(0.9);
    return Math.round(clamp(range / 30, 0, 1) * 55 + clamp((loud + 50) / 35, 0, 1) * 45);
  }
  destroy() { this.off(); }
}

export function trackFxPicker(onChange, current = 'none') {
  return h('div.fxgrid', ...Object.entries(FX_INFO).map(([k, v]) => h('button.fxbtn' + (k === current ? '.sel' : ''), { dataset: { fx: k }, onclick: (e) => { e.currentTarget.parentNode.querySelectorAll('.fxbtn').forEach((b) => b.classList.toggle('sel', b === e.currentTarget)); onChange(k); } }, h('span.e', v.emoji), t(v.label))));
}
export { newId, pickColor };
