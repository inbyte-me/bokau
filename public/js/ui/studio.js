import { h, clear, toast, fmtClock, clamp } from '../util.js';
import { t } from '../i18n.js';
import { app } from '../app.js';
import { api } from '../api.js';
import { Timeline } from './timeline.js';
import { RhythmBand } from './band.js';
import { Stage } from './stage.js';
import { mountCues } from './panels/cues.js';
import { mountVoice } from './panels/voice.js';
import { mountMix } from './panels/mix.js';
import { mountTakes } from './panels/takes.js';
import { mountAi } from './panels/ai.js';
import { exportDialog } from './export.js';

const SHORTCUTS = [
  ['Space', 'Play / pause'], ['R', 'Record / stop (uses the “What to record” mode)'], ['Esc', 'Stop everything'], ['← →', 'Step one frame (Shift: one second)'], ['Home / End', 'Go to start / end'],
  ['⌘/Ctrl + 1…9', 'Set mark (Shift + 1…9 also works if the browser keeps ⌘+number)'], ['⌥/Option + 1…9', 'Jump to mark — keeps playing / recording / paused as it was'],
  ['I / O', 'Set range in / out at the playhead'], ['L', 'Loop the selected cue or range'], ['S', 'Split the clip at the playhead'], ['Delete', 'Delete selected clip or cue'],
  ['M (hold)', 'Mark mouth-open while playing'], ['⌘/Ctrl + Z / ⇧Z', 'Undo / redo'], ['+ / −', 'Zoom the timeline'], ['F', 'TV mode'], ['?', 'This help'],
];
export function shortcutsModal() {
  const back = h('div.modal-back', { onclick: (e) => e.target === back && back.remove() });
  back.append(h('div.modal', { id: 'shortcuts' }, h('h2', '⌨ ' + t('Keyboard shortcuts')), h('div.col', ...SHORTCUTS.map(([k, d]) => h('div.row', h('div', { style: { minWidth: '11em' } }, ...k.split(' ').map((x) => (/^[+/…−]$|^or$/.test(x) ? ` ${x} ` : h('kbd', x)))), h('div.dim', t(d))))), h('div.actions', h('button.primary', { onclick: () => back.remove() }, t('Close')))));
  document.body.append(back);
}

export async function mount(root, { go, topbar }) {
  const { store, engine, session, mic } = app; const p = store.project;
  const stage = new Stage();
  const bandCv = h('canvas.band#band'); const band = new RhythmBand(bandCv);
  const status = h('div.hint#loading', t('Loading audio…'));
  root.append(status);
  try { await engine.load(p, stage.video); } catch (e) { status.textContent = e.message; throw e; }
  status.remove();
  stage.showBanner(localStorage.getItem('banner') !== '0');

  // ---- top bar extras ----
  const title = h('input.title#proj-title', { type: 'text', value: p.name, onchange: (e) => store.commit('Rename project', (pr) => { pr.name = e.target.value || pr.name; }, ['meta']) });
  const saveEl = h('div.savestate', '');
  const undoBtn = h('button.icon#undo', { title: t('Undo (Ctrl/⌘+Z)'), onclick: () => { const l = store.undo(); if (l) { engine.refresh(); toast(`↶ ${l}`); } } }, '↶');
  const redoBtn = h('button.icon#redo', { title: t('Redo'), onclick: () => { const l = store.redo(); if (l) { engine.refresh(); toast(`↷ ${l}`); } } }, '↷');
  topbar.querySelector('.spacer').before(title, undoBtn, redoBtn, saveEl, h('button.primary#export-btn', { onclick: () => exportDialog() }, '⬆ ' + t('Export')), h('button.icon#help-btn', { title: t('Keyboard shortcuts (?)'), onclick: shortcutsModal }, '⌨'));
  const offSave = store.on('save-state', (s) => { saveEl.textContent = { saved: '✓ ' + t('saved'), dirty: '…', saving: t('saving…'), error: t('save failed') }[s] || ''; saveEl.className = 'savestate ' + (s === 'error' ? 'error' : ''); });
  saveEl.textContent = '✓ ' + t('saved');

  // ---- transport ----
  const clock = h('div.clock#clock', '00:00'); const lenEl = h('span.dim.mono', ` / ${fmtClock(p.media.duration)}`);
  const playBtn = h('button.icon#play', { title: t('Play / pause (Space)'), onclick: () => togglePlay() }, '▶');
  const recBtn = h('button.icon.rec#rec', { title: t('Record (R)'), onclick: () => toggleRecord() }, '⏺');
  const recMode = h('select#rec-mode', { title: t('What to record') }, ...[['playhead', t('From playhead')], ['cue', t('Selected cue')], ['region', t('Punch range')], ['loop', t('Loop takes (cue/range)')]].map(([v, l]) => h('option', { value: v }, l)));
  const loopBtn = h('button.icon#loop-play', { title: t('Loop playback of the selected range (L)'), onclick: () => tl.loopFromSelection() }, '🔁');
  const miniMeter = h('div.meter', h('i'), h('b'));
  const micBtn = h('span.chip#mic-chip', t('mic closed'));
  const transport = h('div.transport', h('button.icon#to-start', { title: 'Home', onclick: () => engine.seek(0) }, '⏮'), h('button.icon', { title: t('Back one frame (←)'), onclick: () => engine.stepFrame(-1) }, '◂'), playBtn, h('button.icon', { title: t('Forward one frame (→)'), onclick: () => engine.stepFrame(1) }, '▸'),
    h('button.icon#stop', { title: t('Stop'), onclick: () => { stopAll(); engine.seek(p.loop?.start ?? 0); } }, '⏹'), h('div.sep'), recBtn, recMode, loopBtn, h('div.sep'), clock, lenEl, h('div.spacer'), micBtn, miniMeter,
    h('div.sep'), h('span.dim.small', t('Take:')), h('span.chip#track-chip', ''));
  const timeline = h('div.timeline'); const tl = new Timeline(timeline);

  // ---- side panels ----
  const tabsDef = [['cues', '💬', t('Cues'), mountCues], ['voice', '🎙', t('Voice'), mountVoice], ['mix', '🎚', t('Mix'), (r) => mountMix(r, { band, stage })], ['takes', '🎞', t('Takes'), mountTakes], ['ai', '✨', t('AI'), mountAi]];
  const panel = h('div.panel#panel'); const tabs = h('div.tabs'); let curTab = null, curPanel = null;
  const showTab = (id) => { curPanel?.destroy?.(); clear(panel); curTab = id; const d = tabsDef.find((x) => x[0] === id); curPanel = d[3](panel); [...tabs.children].forEach((b) => b.classList.toggle('sel', b.dataset.tab === id)); try { sessionStorage.setItem('tab', id); } catch {} };
  tabsDef.forEach(([id, em, label]) => tabs.append(h('button.tab', { dataset: { tab: id }, id: 'tab-' + id, onclick: () => showTab(id) }, `${em} ${label}`)));
  const side = h('div.side', tabs, panel);
  const studioEl = h('div.studio', h('div.stage-wrap', stage.el, bandCv), side, transport, timeline);
  root.append(studioEl);
  showTab(sessionStorage.getItem('tab') && tabsDef.some((d) => d[0] === sessionStorage.getItem('tab')) ? sessionStorage.getItem('tab') : (p.cues.length ? 'voice' : 'cues'));

  // ---- behaviour ----
  const playing = () => engine.playing;
  function stopAll() { if (session.state !== 'idle') session.stop(); if (engine.playing) engine.pause(); }
  async function togglePlay() {
    if (session.state !== 'idle') return session.stop();
    if (engine.playing) { engine.pause(); return; }
    const loop = store.project.loop;
    if (loop && engine.time >= loop.start - 0.01 && engine.time < loop.end) await engine.playAt(engine.time, undefined, { to: loop.end });
    else if (loop) await engine.playAt(loop.start, undefined, { to: loop.end });
    else await engine.play();
  }
  engine.on('ended', () => { // loop playback (recording sessions handle their own end)
    const loop = store.project.loop; if (session.state !== 'idle' || !engine.playing || !loop) return;
    engine.playAt(loop.start, undefined, { to: loop.end });
  });
  function recordTarget() {
    const mode = recMode.value; const tr = app.track; const cue = p.cues.find((c) => c.id === app.sel.cueId); const region = app.sel.region;
    if (mode === 'cue') { if (!cue) return { err: t('Select a cue first (click it in the Cues tab or the cue lane)') }; return { start: Math.max(0, cue.start - 0.05), end: Math.min(engine.duration, cue.end + 0.25) }; }
    if (mode === 'region') { if (!region) return { err: t('Shift+drag on the timeline to choose the range to re-record') }; return { start: region.start, end: region.end }; }
    if (mode === 'loop') { const r = region || (cue && { start: Math.max(0, cue.start - 0.05), end: Math.min(engine.duration, cue.end + 0.25) }) || store.project.loop; if (!r) return { err: t('Select a cue or Shift+drag a range to loop-record') }; return { ...r, loop: true }; }
    return { start: engine.time, end: null };
  }
  async function toggleRecord(override) {
    if (session.state !== 'idle') return session.stop();
    if (!mic.isOpen) { toast(t('Open your microphone first (Voice tab)'), 'error'); showTab('voice'); return; }
    const tr = app.track; const tgt = override || recordTarget(); if (tgt.err) return toast(tgt.err, 'error');
    try { const takes = await session.start({ trackId: tr.id, start: tgt.start, end: tgt.end, loop: !!tgt.loop, cueId: app.sel.cueId }); if (takes.length) toast(t('{n} take(s) recorded on “{track}”', { n: takes.length, track: tr.name }), 'ok'); }
    catch (e) { toast(e.message, 'error'); }
  }
  app.on('record-cue', (cue, loop) => { recMode.value = loop ? 'loop' : 'cue'; app.select({ cueId: cue.id }); toggleRecord(); });

  const offs = [
    engine.on('time', (tm) => { clock.textContent = fmtClock(tm, { ms: true }); }),
    engine.on('play', () => { playBtn.textContent = '⏸'; }), engine.on('pause', () => { playBtn.textContent = '▶'; }),
    session.on('state', (s) => { recBtn.classList.toggle('on', s === 'recording' || s === 'countdown'); studioEl.classList.toggle('recording', s === 'recording'); playBtn.disabled = false; tl.invalidate(); }),
    mic.on('level', (l) => { const f = clamp((Math.max(-60, l.peakDb) + 60) / 60, 0, 1); miniMeter.firstChild.style.width = `${f * 100}%`; micBtn.textContent = t('mic on'); micBtn.className = 'chip ok'; }),
    app.on('selection', () => { trackChip(); }), store.on('change', () => { undoBtn.disabled = !store.undoStack.length; redoBtn.disabled = !store.redoStack.length; trackChip(); }),
  ];
  const trackChip = () => { const el = transport.querySelector('#track-chip'); const tr = app.track; el.textContent = tr?.name || ''; el.style.color = tr?.color; };
  trackChip(); undoBtn.disabled = true; redoBtn.disabled = true;

  // ---- marks: ⌘/Ctrl+digit (or Shift+digit) sets, ⌥/Option+digit jumps; keeps playing/recording/paused state ----
  const fmtMark = (tm) => fmtClock(tm, { ms: true });
  function setMark(n) {
    const tm = engine.time; store.commit('Set mark', (pr) => { pr.markers = (pr.markers || []).filter((m) => m.n !== n); pr.markers.push({ id: 'm' + n, n, t: tm }); pr.markers.sort((a, b) => a.n - b.n); }, ['markers']);
    toast(`🚩 ${t('Mark')} ${n} · ${fmtMark(tm)}`, 'ok', 1500);
  }
  async function jumpMark(n) {
    const m = (store.project.markers || []).find((x) => x.n === n); if (!m) return toast(`${t('No mark')} ${n} — ${t('set one with ⌘/Ctrl+number')}`, 'error', 2200);
    if (session.state !== 'idle') await session.jump(m.t); else engine.seek(m.t); // seek keeps a paused transport paused and a playing one playing
  }
  app.on('jump-mark', jumpMark); app.on('delete-mark', (n) => store.commit('Delete mark', (pr) => { pr.markers = pr.markers.filter((m) => m.n !== n); }, ['markers']));

  // lip-flap tapping with the M key: hold while the mouth is open
  let tapStart = null;
  const onKey = (e) => {
    const tag = document.activeElement?.tagName; if (/INPUT|TEXTAREA|SELECT/.test(tag) && !(e.key === 'Escape')) return;
    const mod = e.metaKey || e.ctrlKey;
    const dg = /^(?:Digit|Numpad)(\d)$/.exec(e.code || '');
    if (dg) { // e.code, because Option+digit types symbols on macOS
      const n = +dg[1];
      if (mod || (e.shiftKey && !e.altKey)) { e.preventDefault(); setMark(n); return; }
      if (e.altKey) { e.preventDefault(); jumpMark(n); return; }
    }
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'r' || e.key === 'R') { if (!mod) { e.preventDefault(); toggleRecord(); } }
    else if (e.key === 'Escape') { stopAll(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? engine.seek(engine.time - 1) : engine.stepFrame(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? engine.seek(engine.time + 1) : engine.stepFrame(1); }
    else if (e.key === 'Home') engine.seek(0); else if (e.key === 'End') engine.seek(engine.duration);
    else if ((e.key === 'z' || e.key === 'Z') && mod) { e.preventDefault(); (e.shiftKey ? redoBtn : undoBtn).click(); }
    else if (e.key === 'y' && mod) { e.preventDefault(); redoBtn.click(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (tl.deleteSelected()) e.preventDefault(); }
    else if ((e.key === 's' || e.key === 'S') && !mod) tl.splitAtPlayhead();
    else if (e.key === 'l' || e.key === 'L') tl.loopFromSelection();
    else if (e.key === '=' || e.key === '+') tl.zoom(1.4); else if (e.key === '-') tl.zoom(0.7);
    else if (e.key === 'i' || e.key === 'I') { app.sel.region = { start: engine.time, end: app.sel.region?.end > engine.time ? app.sel.region.end : Math.min(engine.duration, engine.time + 2) }; tl.invalidate(); app.emit('selection', app.sel); }
    else if (e.key === 'o' || e.key === 'O') { const s = app.sel.region?.start ?? Math.max(0, engine.time - 2); app.sel.region = { start: Math.min(s, engine.time - 0.1), end: engine.time }; tl.invalidate(); app.emit('selection', app.sel); }
    else if (e.key === '?') shortcutsModal();
    else if ((e.key === 'f' || e.key === 'F') && !mod) import('../main.js').then((m) => m.toggleTv());
    else if ((e.key === 'm' || e.key === 'M') && !e.repeat && engine.playing && tapStart == null) tapStart = engine.time;
  };
  const onKeyUp = (e) => { if ((e.key === 'm' || e.key === 'M') && tapStart != null) { const s = tapStart, en = engine.time; tapStart = null; if (en - s > 0.04) store.commit('Tap lip flap', (pr) => { pr.lipFlaps.push({ start: s, end: en }); pr.lipFlaps.sort((a, b) => a.start - b.start); }, ['flaps']); } };
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp);
  const onUnload = (e) => { if (store.saveState !== 'saved' && store.saveState !== 'error') { store.flush(); } };
  window.addEventListener('beforeunload', onUnload);

  return {
    async destroy() {
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('beforeunload', onUnload);
      offs.forEach((f) => f()); offSave(); curPanel?.destroy?.(); tl.destroy(); band.destroy(); stage.destroy();
      if (session.state !== 'idle') session.stop(); engine.stop(); await store.flush(); mic.close();
    },
    tl, band, stage, showTab, toggleRecord, togglePlay,
  };
}
