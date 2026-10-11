import { h, clear, toast, fmtClock, fmtBytes, clamp } from '../util.js';
import { t } from '../i18n.js';
import { app } from '../app.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { Stage } from './stage.js';
import { mountVoice } from './panels/voice.js';
import { STT_MODELS, transcribeProject } from '../stt/client.js';
import { newCue } from '/shared/project.js';
import { drawWave } from '../audio/peaks.js';

const MIME_VIDEO = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const MIME_AUDIO = ['audio/webm;codecs=opus', 'audio/webm'];
const pickMime = (list) => list.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';

export async function mount(root, { go, topbar }) {
  const p = app.store.project;
  const body = h('div.pod'); root.append(body);
  let cleanup = () => {};
  const show = async () => { cleanup(); clear(body); cleanup = (p.media?.ready ? await review(body, { go }) : recorder(body, { go, topbar })) || (() => {}); };
  await show(); app.on('podcast-recorded', show);
  return { destroy: async () => { cleanup(); app.engine.stop(); await app.store.flush(); app.mic.close(); } };
}

// ============================================================ recorder
function recorder(root, { go }) {
  const { mic, engine, store } = app; const p = store.project;
  let cam = null, rec = null, startedAt = 0, pausedAt = 0, pausedTotal = 0, bytes = 0, queue = Promise.resolve(), tick = 0, state = 'idle';
  const preview = h('video#cam-preview', { muted: true, playsInline: true, autoplay: true, style: { transform: 'scaleX(-1)' } });
  const timer = h('div.clock#rec-timer', '00:00'); const size = h('span.small.dim.mono#rec-size', '0 KB'); const status = h('div.hint#rec-status', t('Choose your camera and microphone, check the level, then record.'));
  const useVideo = h('input#use-video', { type: 'checkbox', checked: localStorage.getItem('podVideo') !== '0', onchange: async (e) => { localStorage.setItem('podVideo', e.target.checked ? '1' : '0'); await openCamera(); } });
  const camSel = h('select#cam-device', { onchange: openCamera });
  const meterFill = h('i'); const meter = h('div.meter.big#pod-meter', meterFill); const meterTxt = h('div.small.mono.dim#pod-db', '—');
  const recBtn = h('button.signal.big-btn#pod-rec', { onclick: toggle }, icon('rec'), t('Record'));
  const pauseBtn = h('button.big-btn#pod-pause', { disabled: true, onclick: pauseResume }, icon('pause'), t('Pause'));
  const chapBtn = h('button#pod-chapter', { disabled: true, onclick: addChapter }, icon('flag'), t('Add chapter'));
  const chapList = h('div.col#pod-chapters');

  async function openCamera() {
    cam?.getTracks().forEach((x) => x.stop()); cam = null; preview.srcObject = null;
    if (!useVideo.checked) { status.textContent = t('Audio only: no camera will be recorded.'); return; }
    try {
      cam = await navigator.mediaDevices.getUserMedia({ video: { deviceId: camSel.value ? { exact: camSel.value } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
      preview.srcObject = cam; const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const cur = cam.getVideoTracks()[0].getSettings().deviceId; clear(camSel); cams.forEach((c) => camSel.append(h('option', { value: c.deviceId, selected: c.deviceId === cur }, c.label || t('Camera'))));
    } catch (e) { status.textContent = t('Camera unavailable: {m}. You can still record audio only.', { m: e.message }); }
  }
  async function ensureMic() { if (mic.isOpen) return true; try { await engine.init(); await engine.resume(); await mic.open({ deviceId: mic.settings.deviceId }); return true; } catch (e) { toast(t('Microphone error: {m}', { m: e.message }), 'error'); return false; } }
  const offLevel = mic.on('level', (l) => { meterFill.style.width = `${clamp((Math.max(-60, l.peakDb) + 60) / 60, 0, 1) * 100}%`; meterTxt.textContent = `${l.peakDb > -90 ? l.peakDb.toFixed(1) : '-∞'} dBFS${l.clipped ? ' · ' + t('clipping') : ''}`; meterTxt.style.color = l.clipped ? 'var(--signal-text)' : ''; });

  const elapsed = () => (state === 'paused' ? pausedAt - startedAt - pausedTotal : performance.now() - startedAt - pausedTotal) / 1000;
  function renderChapters() { clear(chapList); (store.project.podcast.chapters || []).forEach((c, i) => chapList.append(h('div.row', h('span.mono.dim', fmtClock(c.t)), h('input.grow', { type: 'text', value: c.title, onchange: (e) => store.commit('Chapter title', (pr) => { pr.podcast.chapters[i].title = e.target.value; }, ['podcast']) })))); }
  function addChapter() { const tt = elapsed(); store.commit('Add chapter', (pr) => { pr.podcast.chapters.push({ t: tt, title: `${t('Chapter')} ${pr.podcast.chapters.length + 1}` }); }, ['podcast']); renderChapters(); }

  async function toggle() { return state === 'idle' ? start() : stop(); }
  async function start() {
    if (!(await ensureMic())) return; if (useVideo.checked && !cam) await openCamera();
    const withVideo = useVideo.checked && !!cam; const mimeType = pickMime(withVideo ? MIME_VIDEO : MIME_AUDIO);
    const tracks = [...(withVideo ? cam.getVideoTracks() : []), ...mic.recordStream.getAudioTracks()];
    rec = new MediaRecorder(new MediaStream(tracks), { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 3_000_000, audioBitsPerSecond: 192_000 });
    await api.post(`/api/projects/${p.id}/recording/start`, {}); bytes = 0; queue = Promise.resolve(); store.commit('Reset chapters', (pr) => { pr.podcast.chapters = []; }, ['podcast']); renderChapters();
    rec.ondataavailable = (e) => { if (!e.data.size) return; bytes += e.data.size; size.textContent = fmtBytes(bytes); queue = queue.then(() => fetch(`/api/projects/${p.id}/recording/append`, { method: 'POST', body: e.data }).then((r) => { if (!r.ok) throw new Error('upload ' + r.status); })).catch((err) => { status.textContent = t('Saving failed: {m}', { m: err.message }); }); };
    rec.start(1000); startedAt = performance.now(); pausedTotal = 0; state = 'recording';
    recBtn.replaceChildren(icon('stop'), t('Stop')); recBtn.classList.add('on'); pauseBtn.disabled = false; chapBtn.disabled = false; useVideo.disabled = true; camSel.disabled = true; status.textContent = t('Recording. Each second is saved to disk as it is captured.');
    tick = setInterval(() => { timer.textContent = fmtClock(elapsed()); }, 200);
  }
  function pauseResume() {
    if (state === 'recording') { rec.pause(); pausedAt = performance.now(); state = 'paused'; pauseBtn.replaceChildren(icon('play'), t('Resume')); status.textContent = t('Paused.'); }
    else if (state === 'paused') { rec.resume(); pausedTotal += performance.now() - pausedAt; state = 'recording'; pauseBtn.replaceChildren(icon('pause'), t('Pause')); status.textContent = t('Recording. Each second is saved to disk as it is captured.'); }
  }
  async function stop() {
    clearInterval(tick); const finalChapters = store.project.podcast.chapters; void finalChapters;
    await new Promise((res) => { rec.onstop = res; rec.stop(); }); state = 'idle'; recBtn.disabled = true; pauseBtn.disabled = true; chapBtn.disabled = true;
    status.textContent = t('Finishing the recording…'); await queue;
    try {
      const { job } = await api.post(`/api/projects/${p.id}/recording/finish?kind=${useVideo.checked && cam ? 'video' : 'audio'}`, {});
      await api.waitJob(job, (j) => { status.textContent = `${t('Preparing')}: ${j.message || ''} ${Math.round(j.progress * 100)}%`; });
      cam?.getTracks().forEach((x) => x.stop()); await store.flush(); const fresh = await api.project(p.id); store.refreshServerParts(fresh); Object.assign(store.project, { media: fresh.media });
      app.emit('podcast-recorded');
    } catch (e) { toast(e.message, 'error'); recBtn.disabled = false; status.textContent = e.message; }
  }

  const audioSetup = h('details.box', h('summary', t('Audio setup'))); const voiceHost = h('div.col', { style: { marginTop: '.6rem' } }); audioSetup.append(voiceHost); const voice = mountVoice(voiceHost);
  root.append(h('div.pod-stage', h('div.stage-box', h('div.stage', preview, h('div.recbadge', { id: 'pod-live' }, timer))), h('div.row', size, h('div.spacer'), status)),
    h('div.pod-side', h('h1', t('Podcast')), h('p.lead', t('Record audio and video straight from your camera and microphone. Chapters you add while recording are saved with the episode.')),
      h('div.box', h('h4', t('Sources')), h('label.row', useVideo, t('Record video')), h('div.field', h('label', t('Camera')), camSel), meter, meterTxt),
      h('div.row', recBtn, pauseBtn), h('div.row', chapBtn, h('span.small.dim', `${t('Press')} M`)), chapList, audioSetup));
  const onKey = (e) => { if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return; if (e.key === 'm' || e.key === 'M') { if (state !== 'idle') addChapter(); } else if (e.key === ' ') { e.preventDefault(); toggle(); } };
  window.addEventListener('keydown', onKey); openCamera().then(() => ensureMic());
  return () => { window.removeEventListener('keydown', onKey); clearInterval(tick); offLevel(); voice.destroy?.(); cam?.getTracks().forEach((x) => x.stop()); if (state !== 'idle') { try { rec.stop(); } catch {} } };
}

// ============================================================ review + export
async function review(root, { go }) {
  const { engine, store } = app; const p = store.project;
  const stage = new Stage(); stage.showBanner(true);
  await engine.load(p, stage.video);
  const strip = h('canvas#wave', { style: { width: '100%', height: '110px', display: 'block', background: '#0b0b0a', border: '1px solid var(--line)', cursor: 'pointer' } });
  const dur = engine.duration; const pod = () => store.project.podcast;
  const clock = h('div.clock#clock', '00:00.000'); const lenEl = h('span.dim.mono', ` / ${fmtClock(dur)}`);
  const playBtn = h('button.primary#pod-play', { onclick: () => (engine.playing ? engine.pause() : engine.play(clampTrim(engine.time))) }, icon('play'), t('Play'));
  const clampTrim = (tt) => { const tr = pod().trim; return tr && (tt < tr.start || tt >= tr.end) ? tr.start : tt; };
  const trimInfo = h('div.small.dim.mono#trim-info');
  const setTrim = (patch) => store.commit('Trim', (pr) => { const cur = pr.podcast.trim || { start: 0, end: dur }; const nx = { ...cur, ...patch }; pr.podcast.trim = nx.end - nx.start < 0.5 || (nx.start <= 0.01 && nx.end >= dur - 0.01) ? null : nx; }, ['podcast']);

  // waveform strip with trim handles and chapter flags
  let drag = null;
  const draw = () => {
    const dpr = window.devicePixelRatio || 1; const W = strip.clientWidth, H = strip.clientHeight; if (!W) return; strip.width = W * dpr; strip.height = H * dpr; const c = strip.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#0b0b0a'; c.fillRect(0, 0, W, H); const pk = engine.assets.peaks.get('orig'); const x = (tt) => (tt / dur) * W;
    drawWave(c, pk, { x0: 0, x1: W, y: 14, h: H - 24, t0: 0, t1: dur, color: '#7f8a96' });
    const tr = pod().trim; if (tr) { c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(0, 0, x(tr.start), H); c.fillRect(x(tr.end), 0, W - x(tr.end), H); c.fillStyle = '#e3b04b'; c.fillRect(x(tr.start) - 1, 0, 3, H); c.fillRect(x(tr.end) - 2, 0, 3, H); }
    c.font = 'bold 10px ui-monospace, Menlo, monospace'; for (const [i, ch] of (pod().chapters || []).entries()) { const cx = x(ch.t); c.fillStyle = 'rgba(227,176,75,.6)'; c.fillRect(cx, 0, 1, H); c.fillStyle = '#e3b04b'; c.fillRect(cx, 0, 14, 12); c.fillStyle = '#1a1405'; c.fillText(String(i + 1), cx + 3, 9); }
    c.fillStyle = '#e8473a'; c.fillRect(x(engine.time) - 0.75, 0, 1.5, H);
  };
  const posT = (e) => clamp(((e.clientX - strip.getBoundingClientRect().left) / strip.clientWidth) * dur, 0, dur);
  strip.addEventListener('pointerdown', (e) => { strip.setPointerCapture(e.pointerId); const tt = posT(e); const tr = pod().trim; const near = (v) => Math.abs(((tt - v) / dur) * strip.clientWidth) < 8; if (tr && near(tr.start)) drag = 'start'; else if (tr && near(tr.end)) drag = 'end'; else { drag = 'seek'; engine.seek(tt); } });
  strip.addEventListener('pointermove', (e) => { if (!drag) return; const tt = posT(e); if (drag === 'seek') engine.seek(tt); else setTrim({ [drag]: tt }); });
  strip.addEventListener('pointerup', () => { drag = null; });

  // chapters
  const chapList = h('div.col#pod-chapters');
  const renderChapters = () => { clear(chapList); const cs = pod().chapters || []; if (!cs.length) chapList.append(h('div.hint', t('No chapters. Add one at the playhead with M. Podcast apps show them as a table of contents.')));
    cs.forEach((c, i) => chapList.append(h('div.row', { dataset: { chapter: i } }, h('button.ghost.mono', { onclick: () => engine.seek(c.t) }, fmtClock(c.t)), h('input.grow', { type: 'text', value: c.title, onchange: (e) => store.commit('Chapter title', (pr) => { pr.podcast.chapters[i].title = e.target.value; }, ['podcast']) }), h('button.ghost.icon', { title: t('Delete'), onclick: () => store.commit('Delete chapter', (pr) => { pr.podcast.chapters.splice(i, 1); }, ['podcast']) }, icon('close', 12))))); };
  const addChapter = () => store.commit('Add chapter', (pr) => { pr.podcast.chapters.push({ t: engine.time, title: `${t('Chapter')} ${pr.podcast.chapters.length + 1}` }); pr.podcast.chapters.sort((a, b) => a.t - b.t); pr.podcast.chapters.forEach((c, i) => { if (/^(Chapter|Capítulo) \d+$/.test(c.title)) c.title = `${t('Chapter')} ${i + 1}`; }); }, ['podcast']);

  // transcript
  const sttStatus = h('div.hint#pod-stt'); const lang = h('select#pod-lang', ...[['auto', t('Auto-detect')], ['english', 'English'], ['spanish', 'Español'], ['french', 'Français'], ['portuguese', 'Português']].map(([v, l]) => h('option', { value: v }, l)));
  const transcribe = h('button#pod-transcribe', { onclick: async () => {
    transcribe.disabled = true; sttStatus.textContent = t('Starting speech recognition…');
    try { const r = await transcribeProject(store.project, { model: STT_MODELS[1].id, language: lang.value, onProgress: (e) => { sttStatus.textContent = e.type === 'progress' ? `${t('Downloading model')} ${Math.round(e.pct * 100)}%` : t('Transcribing…'); } });
      store.commit('Transcribe', (pr) => { pr.cues = r.cues.map((c) => newCue({ start: c.start, end: c.end, text: c.text })); }, ['cues']); sttStatus.textContent = t('{n} cues from speech recognition.', { n: r.cues.length }); } catch (e) { sttStatus.textContent = e.message; } finally { transcribe.disabled = false; }
  } }, t('Transcribe'));

  // export
  const opt = (id, label, checked) => { const el = h('input', { id, type: 'checkbox', checked, onchange: save }); return [el, h('label.row.small', el, label)]; };
  const [rumble, rumbleRow] = opt('pod-rumble', t('Remove low rumble (desk thumps, hum)'), pod().clean.rumble); const [denoise, denoiseRow] = opt('pod-denoise', t('Reduce background noise'), pod().clean.denoise);
  const [compress, compressRow] = opt('pod-compress', t('Even out volume (gentle compression)'), pod().clean.compress); const [loud, loudRow] = opt('pod-loud', t('Normalize loudness to −16 LUFS (podcast standard)'), pod().loudnorm);
  const fmt = h('select#pod-format', onchangeSave(), ...[['mp3', 'MP3 · 192 kbps'], ['m4a', 'M4A (AAC) · chapters'], ['wav', 'WAV · lossless'], ...(p.media.hasVideo ? [['mp4', 'MP4 video'], ['webm', 'WebM video']] : [])].map(([v, l]) => h('option', { value: v, selected: pod().format === v }, l)));
  function onchangeSave() { return { onchange: save }; }
  function save() { store.commit('Podcast options', (pr) => { pr.podcast.clean = { rumble: rumble.checked, denoise: denoise.checked, compress: compress.checked }; pr.podcast.loudnorm = loud.checked; pr.podcast.format = fmt.value; }, ['podcast']); }
  const results = h('div.col#pod-results'); const prog = h('div.progress.hidden', h('i')); const msg = h('div.small.dim#pod-msg');
  const exportBtn = h('button.primary#pod-export', { onclick: async () => {
    exportBtn.disabled = true; clear(results); prog.classList.remove('hidden'); const bar = prog.firstChild;
    try { await store.flush(); const o = pod(); const { job } = await api.post(`/api/projects/${p.id}/podcast-export`, { format: o.format, clean: o.clean, loudnorm: o.loudnorm, trim: o.trim, chapters: o.chapters });
      const res = await api.waitJob(job, (j) => { bar.style.width = `${j.progress * 100}%`; msg.textContent = `${j.message || ''}`; });
      msg.textContent = `${fmtClock(res.seconds)} · ${res.loudness.integrated != null ? res.loudness.integrated.toFixed(1) + ' LUFS' : ''} · ${t('peak')} ${res.loudness.truePeak != null ? res.loudness.truePeak.toFixed(1) + ' dBFS' : ''}`;
      for (const f of res.files) results.append(h('a.take', { href: `/media/${p.id}/exports/${res.dir}/${f}`, download: f, dataset: { file: f } }, h('div.grow', f), h('span.small.dim', fmtBytes(res.sizes[f])), icon('download')));
    } catch (e) { toast(e.message, 'error'); msg.textContent = e.message; } finally { exportBtn.disabled = false; }
  } }, icon('export'), t('Export'));

  const side = h('div.pod-side', h('h1', p.name),
    h('div.box', h('h4', t('Trim')), h('div.row', h('button#trim-in', { onclick: () => setTrim({ start: engine.time }) }, t('Start here (I)')), h('button#trim-out', { onclick: () => setTrim({ end: engine.time }) }, t('End here (O)')), h('button.ghost', { onclick: () => store.commit('Clear trim', (pr) => { pr.podcast.trim = null; }, ['podcast']) }, t('Clear'))), trimInfo),
    h('div.box', h('h4', t('Chapters')), h('button#pod-add-chapter', { onclick: addChapter }, icon('flag'), t('Add chapter at playhead (M)')), chapList),
    h('div.box', h('h4', t('Transcript')), h('div.row', lang, transcribe), sttStatus),
    h('div.box', h('h4', t('Voice clean-up')), rumbleRow, denoiseRow, compressRow, loudRow),
    h('div.box', h('h4', t('Export')), h('div.field', h('label', t('Format')), fmt), exportBtn, prog, msg, results),
    h('div.row', h('button#pod-new', { onclick: async () => { const np = await api.createProject(`${t('Podcast')} ${new Date().toLocaleDateString()}`, 'podcast'); go(`/p/${np.id}`); } }, icon('plus'), t('New recording'))));
  root.append(h('div.pod-stage', h('div.stage-box', stage.el), strip, h('div.row', h('div.grp', h('button.icon', { onclick: () => engine.seek(0) }, icon('start')), playBtn), clock, lenEl, h('div.spacer'), h('span.small.dim', t('Click the waveform to move; drag the amber handles to trim.')))), side);
  renderChapters();
  const updateTrimInfo = () => { const tr = pod().trim; trimInfo.textContent = tr ? `${fmtClock(tr.start, { ms: true })} → ${fmtClock(tr.end, { ms: true })} · ${fmtClock(tr.end - tr.start)}` : t('Whole recording'); };
  updateTrimInfo();
  const offs = [engine.on('time', (tm) => { clock.textContent = fmtClock(tm, { ms: true }); draw(); const tr = pod().trim; if (tr && engine.playing && tm >= tr.end) engine.pause(); }), engine.on('play', () => playBtn.replaceChildren(icon('pause'), t('Pause'))), engine.on('pause', () => { playBtn.replaceChildren(icon('play'), t('Play')); draw(); }),
    store.on('change', (k) => { if (k.has('podcast') || k.has('all')) { renderChapters(); updateTrimInfo(); draw(); } })];
  const onKey = (e) => { if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return; if (e.key === ' ') { e.preventDefault(); playBtn.click(); } else if (e.key === 'm' || e.key === 'M') addChapter(); else if (e.key === 'i' || e.key === 'I') setTrim({ start: engine.time }); else if (e.key === 'o' || e.key === 'O') setTrim({ end: engine.time }); };
  window.addEventListener('keydown', onKey); setTimeout(draw, 50); new ResizeObserver(draw).observe(strip);
  return () => { window.removeEventListener('keydown', onKey); offs.forEach((f) => f()); stage.destroy(); };
}
