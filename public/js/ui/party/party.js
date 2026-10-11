import { h, clear, toast, fmtClock, clamp } from '../../util.js';
import { t, getLang } from '../../i18n.js';
import { app } from '../../app.js';
import { api } from '../../api.js';
import { Stage } from '../stage.js';
import { Karaoke } from '../karaoke.js';
import { rewriteCues } from '../../ai.js';
import { exportDialog } from '../export.js';
import { newCue } from '/shared/project.js';
import { countText, detectLang } from '/shared/syllables.js';
import { readyStrip, ensureMic, busyOverlay, ensureTranscript, makeSlots, setScript, ensureTrack, DramaMeter, RANDOM_FX, trackFxPicker, audioSetupModal } from './common.js';

const PLAYER_COLORS = ['#ff6b6b', '#4dd4ac', '#ffd166', '#6aa6ff', '#c792ea', '#ff9f68'];
const PREMISES = ['two people arguing about lost cheese', 'a cooking show where everything catches fire', 'a dramatic breakup over a WiFi password', 'two spies who forgot the secret code', 'a nature documentary about a very lazy cat'];
const GENRES = [['noir', '🕵️', 'Noir Detective', 'Gritty inner monologue, 1940s slang, rain on the window.'], ['pirate', '🏴‍☠️', 'Pirate Swashbuckler', 'Nautical insults, treasure and the odd sea shanty.'], ['corporate', '💼', 'Bad Corporate Speak', 'Synergistic alignment and quarterly targets.'], ['action80s', '💥', '80s Action Movie', 'Every line ends with an explosion-ready one-liner.']];

export async function mount(root, { go, topbar }) {
  const { store, engine, session, mic } = app; const p = store.project;
  if (!p.party.configured) store.commit('Party defaults', (pr) => { pr.party.configured = true; pr.settings.output = 'speakers'; pr.settings.muteOriginalWhileRecording = true; pr.settings.preRoll = 3; pr.settings.preRollBeep = true; pr.ducking.enabled = false; }, ['settings']);
  const stage = new Stage(); stage.showBanner(false);
  const loading = h('div.hint', { style: { padding: '2rem' } }, t('Loading…')); root.append(loading);
  await engine.load(store.project, stage.video); loading.remove();
  const body = h('div.party'); root.append(body);
  const P = { root: body, go, stage, offs: [], cleanups: [] };
  const setScreen = (el, { cleanup } = {}) => { P.cleanups.splice(0).forEach((f) => { try { f(); } catch {} }); if (cleanup) P.cleanups.push(cleanup); clear(body); body.append(el); };
  P.setScreen = setScreen; P.hub = () => setScreen(hub(P));
  const title = h('span.small.dim', ' · ' + p.name); topbar.querySelector('.spacer').before(title, h('button#party-hub', { onclick: () => { stopAll(); P.hub(); } }, '🏠 ' + t('Games')), h('button.icon#party-audio', { title: t('Audio setup'), onclick: audioSetupModal }, '🎧'));
  const stopAll = () => { if (session.state !== 'idle') session.stop(); if (engine.playing) engine.pause(); };
  const onKey = (e) => { if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return; if (e.key === 'Escape') stopAll(); if (e.key === 'f' || e.key === 'F') import('../../main.js').then((m) => m.toggleTv()); };
  window.addEventListener('keydown', onKey);
  engine.on('time', (tm) => P.kara?.update(tm));
  P.hub();
  return { destroy: async () => { window.removeEventListener('keydown', onKey); stopAll(); P.cleanups.forEach((f) => f()); stage.destroy(); engine.stop(); await store.flush(); mic.close(); }, P };
}

// ---------------------------------------------------------------- hub
function hub(P) {
  const p = app.project; const card = (id, em, title, desc, fn) => h('button.mcard', { id: 'mode-' + id, onclick: fn }, h('div.em', em), h('h3', title), h('p', desc));
  const prior = p.cues.length || p.tracks.some((x) => x.clips.length);
  return h('div.party-body', h('div', h('h1', '🎉 ' + t('Pick a game')), h('div.lead', t('Everyone shares one mic. Use the arrow keys / Enter or a clicker — it works from the sofa.'))),
    h('div.mode-cards', card('badlip', '🧀', t('Bad Lip Reading'), t('The AI invents absurd lines that fit the mouths. You read them karaoke-style.'), () => badLip(P)),
      card('tele', '💔', t('Telenovela Overdrive'), t('Everyday dialogue becomes a soap-opera meltdown. Deliver it with maximum emotion.'), () => genreFlow(P, 'telenovela')),
      card('blind', '🙈', t('Blind Dubbing Challenge'), t('Pass the mic: each player dubs a silent segment seeing only the last second of the previous player.'), () => blind(P)),
      card('genre', '🎭', t('Genre Swapper'), t('Noir, pirates, corporate jargon or an 80s action hero take over the dialogue.'), () => genreFlow(P, 'genre'))),
    h('div', readyStrip()),
    prior ? h('div.row', h('span.dim', t('This clip already has a script / recordings:')), h('button#party-replay', { onclick: () => reveal(P, { title: t('Replay') }) }, '▶ ' + t('Replay it')), h('button', { onclick: () => exportDialog() }, '⬆ ' + t('Export'))) : null);
}

// ---------------------------------------------------------------- helpers
function shell(P, { title, lead, form, primary, onBack }) {
  return h('div.party-body', h('div.row', h('button.ghost#back', { onclick: onBack || (() => P.hub()) }, '← ' + t('Back')), h('h1', title)), lead ? h('div.lead', lead) : null,
    h('div.row', { style: { alignItems: 'flex-start', gap: '1.5rem', flexWrap: 'wrap' } }, h('div.col.grow', { style: { minWidth: '320px' } }, ...form), h('div', { style: { width: 'min(520px, 100%)' } }, h('div.stage-box.small', P.stage.el))),
    readyStrip(), h('div.row', primary));
}
async function prepareOriginal(busy, { keepMusic = true } = {}) {
  const pr = app.project;
  if (pr.media.hasAudio && pr.stems.status === 'none') {
    busy?.set(t('Silencing the original actors…'), t('Separating dialogue from music + sound effects'), 0.1);
    try { const { job } = await api.post(`/api/projects/${pr.id}/stems`); await api.waitJob(job, (j) => busy?.set(null, `${Math.round(j.progress * 100)}%`, 0.1 + j.progress * 0.3)); const fresh = await api.project(pr.id); app.store.refreshServerParts(fresh); if (fresh.stems.status === 'ready') await app.engine.assets.loadStems(); } catch (e) { console.warn('stems', e); }
  }
  const ready = app.project.stems.status === 'ready';
  app.store.commit('Party audio', (p) => { p.original.source = ready && keepMusic ? 'bg' : 'full'; p.original.mute = !ready || !keepMusic; p.original.volume = ready ? 0.75 : p.original.volume; }, ['levels']);
  return ready;
}
function langOptions(sel) { return ['en', 'es', 'fr'].map((v) => h('option', { value: v, selected: v === sel }, { en: 'English', es: 'Español', fr: 'Français' }[v])); }
const defaultLang = () => (getLang() === 'es' ? 'es' : 'en');

// ---------------------------------------------------------------- A: bad lip reading
function badLip(P) {
  const prompt = h('input#prompt', { type: 'text', value: t(PREMISES[0]), style: { width: '100%' } });
  const lang = h('select#out-lang', ...langOptions(defaultLang()));
  const match = h('input#match-sounds', { type: 'checkbox', checked: app.project.media.duration <= 60 && app.project.media.hasAudio });
  const chips = h('div.row', { style: { flexWrap: 'wrap' } }, ...PREMISES.map((s) => h('button.chip', { onclick: () => { prompt.value = t(s); } }, t(s))));
  const go = h('button.primary.big-btn#badlip-go', { onclick: async () => {
    if (!(await ensureMic())) return; const busy = busyOverlay(t('Reading the lips…'));
    try {
      const ready = await prepareOriginal(busy, { keepMusic: true }); void ready;
      busy.set(t('Finding where people talk…'), '', 0.4);
      const slots = await makeSlots({ matchSounds: match.checked, busy, language: lang.value === 'es' ? 'spanish' : lang.value === 'fr' ? 'french' : 'english' });
      const slotCues = slots.map((s, i) => ({ id: 's' + i, start: s.start, end: s.end, text: s.text }));
      busy.set(t('The AI is writing absurd lines…'), '', 0.7);
      const r = await rewriteCues('badlip', slotCues, { prompt: prompt.value, outLang: lang.value, fromLang: lang.value });
      setScript(r.lines, new Map(slotCues.map((c) => [c.id, c])));
      busy.close(); if (r.notice) toast(r.notice, 'error'); toast(r.source === 'ai' ? `🤖 ${r.model}` : '📴 ' + t('offline generator'), 'ok');
      perform(P, { title: t('Bad Lip Reading'), trackName: t('Player'), drama: false, intro: t('Read the lines as they light up — the sillier the better!') });
    } catch (e) { busy.close(); toast(e.message, 'error'); }
  } }, '✨ ' + t('Write the script!'));
  P.setScreen(shell(P, { title: '🧀 ' + t('Bad Lip Reading'), lead: t('Describe what the scene is secretly about. The AI writes lines that sound like the lips are moving.'),
    form: [h('div.field', h('label', t('What are they REALLY talking about?')), prompt), chips, h('div.field', h('label', t('Language of the lines')), lang), h('label.row', match, t('Match the original sounds (runs speech recognition first — better lip fit)'))], primary: [go] }));
}

// ---------------------------------------------------------------- B / D: transcript rewrite games
function genreFlow(P, kind) {
  let genre = 'noir'; const lang = h('select#out-lang', ...langOptions(defaultLang()));
  const srtFile = h('input', { type: 'file', accept: '.srt,.vtt', hidden: true, id: 'party-srt', onchange: async () => { const f = srtFile.files[0]; if (!f) return; try { const { cues } = await api.raw(`/api/projects/${app.project.id}/import-subs`, f); app.store.commit('Import', (pr) => { pr.cues = cues.map((c) => newCue(c)); }, ['cues']); toast(t('{n} cues imported', { n: cues.length }), 'ok'); } catch (e) { toast(e.message, 'error'); } } });
  const genreCards = h('div.mode-cards', { style: { gridTemplateColumns: 'repeat(2,1fr)' } }, ...GENRES.map(([id, em, name, desc]) => h('button.mcard' + (id === genre ? '' : ''), { id: 'genre-' + id, dataset: { genre: id }, style: { minHeight: '110px', borderColor: id === genre ? 'var(--accent)' : '' }, onclick: (e) => { genre = id; genreCards.querySelectorAll('.mcard').forEach((c) => { c.style.borderColor = c.dataset.genre === id ? 'var(--accent)' : ''; }); } }, h('div', { style: { fontSize: '1.8rem' } }, em), h('h3', t(name)), h('p.small', t(desc)))));
  const go = h('button.primary.big-btn#genre-go', { onclick: async () => {
    if (!(await ensureMic())) return; const busy = busyOverlay(kind === 'telenovela' ? t('Summoning melodrama…') : t('Rewriting the scene…'));
    try {
      await prepareOriginal(busy, { keepMusic: true });
      const cues = await ensureTranscript({ language: lang.value === 'es' ? 'spanish' : lang.value === 'fr' ? 'french' : 'auto', busy });
      busy.set(kind === 'telenovela' ? t('Adding betrayal and secret twins…') : t('The AI is rewriting every line…'), '', 0.8);
      const slotCues = cues.map((c) => ({ id: c.id, start: c.start, end: c.end, text: c.text, character: c.character }));
      const r = await rewriteCues(kind === 'telenovela' ? 'telenovela' : 'genre', slotCues, { genre, outLang: lang.value });
      setScript(r.lines, new Map(slotCues.map((c) => [c.id, c]))); busy.close(); if (r.notice) toast(r.notice, 'error');
      perform(P, { title: kind === 'telenovela' ? t('Telenovela Overdrive') : t(GENRES.find((g) => g[0] === genre)[2]), trackName: t('Player'), drama: kind === 'telenovela', intro: kind === 'telenovela' ? t('Give each line MAXIMUM emotion — gasp, sob, whisper, scream!') : t('Stay in character!') });
    } catch (e) { busy.close(); toast(e.message, 'error'); }
  } }, '🎬 ' + t('Rewrite the scene!'));
  const form = [h('div.hint', app.project.cues.length ? `✅ ${t('{n} dialogue lines found.', { n: app.project.cues.length })}` : t('The dialogue will be transcribed automatically (or import subtitles).')), h('div.row', h('button', { onclick: () => srtFile.click() }, '📄 ' + t('Import subtitles')), srtFile), h('div.field', h('label', t('Language')), lang)];
  if (kind === 'genre') form.splice(0, 0, genreCards);
  P.setScreen(shell(P, { title: kind === 'telenovela' ? '💔 ' + t('Telenovela Overdrive') : '🎭 ' + t('Genre Swapper'), lead: kind === 'telenovela' ? t('Every line becomes an over-the-top soap-opera declaration.') : t('Pick a genre — the AI keeps the timing but changes the voice.'), form, primary: [go] }));
}

// ---------------------------------------------------------------- shared perform screen
function perform(P, { title, trackName, drama, intro }) {
  const { engine, session, store } = app; const cues = store.project.cues;
  const kara = new Karaoke(h('div.karaoke#karaoke'), { lead: 3, tail: 0.6, showWho: true, showDirection: true, idle: '🎤' }); kara.el.classList.add('karaoke'); P.kara = kara;
  const dramaBar = h('i'); const meter = drama ? new DramaMeter(dramaBar) : null;
  const lineInfo = h('div.small.dim#line-info'); const status = h('div.hint', intro);
  const fxPick = trackFxPicker((fx) => { const tr = ensureTrack(trackName, { fx }); app.store.commit('Voice effect', () => { tr.fx = fx; }, ['tracks']); });
  const start = h('button.primary.big-btn#perform-start', { onclick: run }, '🎤 ' + t('Start performance'));
  const stop = h('button.big-btn#perform-stop', { onclick: () => session.stop() }, '⏹ ' + t('Finish'));
  const first = cues[0]?.start ?? 0; const startAt = Math.max(0, first - 3.5);
  const offs = [engine.on('time', (tm) => { const i = cues.findIndex((c) => tm >= c.start && tm < c.end); lineInfo.textContent = i >= 0 ? `${t('Line')} ${i + 1} / ${cues.length}` : ''; }), session.on('state', (s) => { start.classList.toggle('hidden', s !== 'idle'); stop.classList.toggle('hidden', s === 'idle'); })];
  async function run() {
    if (!(await ensureMic())) return; const tr = ensureTrack(trackName, { fx: 'none' });
    app.select({ trackId: tr.id }); kara.setCues(cues);
    const takes = await session.start({ trackId: tr.id, start: startAt, end: null }).catch((e) => { toast(e.message, 'error'); return []; });
    if (takes.length) reveal(P, { title, score: meter?.score(), fromStart: startAt, again: () => perform(P, { title, trackName, drama, intro }) });
    else status.textContent = t('Nothing recorded — try again.');
  }
  const screen = h('div.party-body', h('div.row', h('button.ghost', { onclick: () => P.hub() }, '← ' + t('Games')), h('h1', title), h('div.spacer'), lineInfo),
    h('div.party-stage', h('div.col', h('div.stage-box', P.stage.el), kara.el),
      h('div.col', status, drama ? h('div', h('div.small.dim', '🎭 ' + t('Drama-o-meter')), h('div.drama', dramaBar)) : null, h('div.small.dim', t('Voice effect')), fxPick, readyStrip(), start, stop)));
  stop.classList.add('hidden'); kara.el.classList.remove('hidden');
  P.setScreen(screen, { cleanup: () => { offs.forEach((f) => f()); meter?.destroy(); P.kara = null; } });
  engine.seek(startAt); kara.update(startAt); kara.el.classList.remove('hidden');
}

// ---------------------------------------------------------------- reveal / playback
function reveal(P, { title, score, again, fromStart = 0 }) {
  const { engine, session } = app; const p = app.project;
  const info = h('div.small.dim'); const clock = h('div.mono', '');
  const playBtn = h('button.primary.big-btn#reveal-play', { onclick: async () => { if (engine.playing) engine.pause(); else { engine.muteOriginal = false; await engine.play(fromStart); } } }, '▶ ' + t('Play with our voices'));
  const kara = new Karaoke(h('div.karaoke.hidden'), { lead: 0.3, tail: 0.5 }); P.kara = kara;
  const offs = [engine.on('play', () => { playBtn.textContent = '⏸'; }), engine.on('pause', () => { playBtn.textContent = '▶ ' + t('Play with our voices'); }), engine.on('time', (tm) => { clock.textContent = fmtClock(tm); })];
  const screen = h('div.party-body', h('div.row', h('button.ghost', { onclick: () => P.hub() }, '← ' + t('Games')), h('h1', '🎬 ' + t('The reveal') + (title ? ` — ${title}` : ''))),
    h('div.party-stage', h('div.col', h('div.stage-box', P.stage.el), kara.el),
      h('div.col', score != null ? h('div', h('div.small.dim', '🎭 ' + t('Drama score')), h('div', { style: { fontSize: '4rem', fontWeight: 800 }, id: 'drama-score' }, String(score))) : null, playBtn, clock,
        again ? h('button.big-btn#again', { onclick: again }, '🔁 ' + t('Do it again')) : null, h('button.big-btn#reveal-export', { onclick: () => exportDialog() }, '⬆ ' + t('Export the video')), h('button.big-btn', { onclick: () => P.hub() }, '🏠 ' + t('More games')))));
  P.setScreen(screen, { cleanup: () => { offs.forEach((f) => f()); engine.pause(); P.kara = null; } });
  engine.seek(fromStart); kara.el.classList.remove('hidden');
}

// ---------------------------------------------------------------- C: blind dubbing
function blind(P) {
  const dur = app.project.media.duration; let players = [t('Player') + ' 1', t('Player') + ' 2', t('Player') + ' 3'];
  const nSel = h('select#seg-count', ...[4, 5, 6].map((n) => h('option', { value: n, selected: n === clamp(Math.round(dur / 10), 4, 6) }, `${n} ${t('segments')}`)));
  const silly = h('input#silly-fx', { type: 'checkbox', checked: true }); const keep = h('input#keep-music', { type: 'checkbox', checked: true });
  const list = h('div.col#players'); const renderPlayers = () => { clear(list); players.forEach((n, i) => list.append(h('div.row', h('div.avatar', { style: { background: PLAYER_COLORS[i % 6] } }, String(i + 1)), h('input.grow', { type: 'text', value: n, id: 'player-' + i, oninput: (e) => { players[i] = e.target.value; } }), players.length > 2 ? h('button.ghost', { onclick: () => { players.splice(i, 1); renderPlayers(); } }, '✕') : null))); if (players.length < 6) list.append(h('button#add-player', { onclick: () => { players.push(`${t('Player')} ${players.length + 1}`); renderPlayers(); } }, '＋ ' + t('Add player'))); }; renderPlayers();
  const go = h('button.primary.big-btn#blind-go', { onclick: () => runBlind(P, { players: players.map((x, i) => x.trim() || `${t('Player')} ${i + 1}`), n: +nSel.value, silly: silly.checked, keepMusic: keep.checked }) }, '🙈 ' + t('Start the challenge!'));
  P.setScreen(shell(P, { title: '🙈 ' + t('Blind Dubbing Challenge'), lead: t('Each player sees a silent segment and improvises. The next player only sees the last second of the previous performance — then continues the story!'), form: [h('h4', t('Players')), list, h('div.field', h('label', t('Segments')), nSel), h('label.row', silly, t('Give every player a silly voice effect')), h('label.row', keep, t('Keep the original music + sound effects in the reveal (if separable)'))], primary: [go] }));
}

async function runBlind(P, { players, n, silly, keepMusic }) {
  const { engine, session, store } = app; if (!(await ensureMic())) return;
  const busy = busyOverlay(t('Setting up the game…')); const ready = await prepareOriginal(busy, { keepMusic }); busy.close();
  const dur = engine.duration; const len = dur / n; const segs = Array.from({ length: n }, (_, i) => ({ start: i * len, end: (i + 1) * len }));
  const tracks = players.map((name, i) => { const fx = silly ? RANDOM_FX[(i * 2 + 1) % RANDOM_FX.length] : 'none'; const tr = ensureTrack(name, { fx: fx === 'none' && silly ? 'helium' : fx }); store.commit('Reset player', () => { tr.clips = []; tr.takes = []; tr.color = PLAYER_COLORS[i % 6]; }, ['tracks']); return tr; });
  store.commit('Blind setup', (pr) => { pr.tracks = pr.tracks.filter((x) => tracks.some((tr) => tr.id === x.id)); pr.cues = []; pr.party.blind = { players, segs }; }, ['tracks', 'cues']);
  engine.muteOriginal = true;
  for (let i = 0; i < n; i++) {
    const who = i % players.length; const tr = store.project.tracks.find((x) => x.id === tracks[who].id); const seg = segs[i];
    await new Promise((resolve) => {
      const ready_ = h('button.primary.big-btn#pass-ready', { onclick: resolve }, '▶ ' + t("I'm ready"));
      const prevInfo = i > 0 ? h('div.lead', `🔙 ${t('You will first see the last second of')} ${players[(i - 1) % players.length]}${t("'s performance.")}`) : h('div.lead', t('You get the very first segment — start the story!'));
      P.setScreen(h('div.party-body', h('div.pass-screen', h('div', h('div.avatar', { style: { background: PLAYER_COLORS[who % 6], width: '4em', height: '4em', fontSize: '1.6rem', margin: '0 auto 1rem' } }, String(who + 1)), h('h1', `${t('Pass the mic to')} ${players[who]}`), h('div.lead', `${t('Segment')} ${i + 1} / ${n} · ${seg.end - seg.start > 12 ? t('about') + ' ' + Math.round(seg.end - seg.start) + 's' : Math.round(seg.end - seg.start) + 's'}`), prevInfo, ready_))));
      ready_.focus();
    });
    P.setScreen(h('div.party-body', h('div.row', h('h1', `🎤 ${players[who]}`), h('div.spacer'), h('div.chip', `${t('Segment')} ${i + 1}/${n}`)), h('div.stage-box', P.stage.el), h('div.row', h('button.big-btn.hidden', { id: 'blind-stop', onclick: () => session.stop() }, '⏹ ' + t('Done'))), h('div.hint', t('The picture is silent — make up the dialogue!'))));
    if (i > 0) { // "previously": last second of the previous player's performance
      const ps = segs[i - 1]; await engine.playRange(Math.max(ps.start, ps.end - 1), ps.end, { include: { original: false, voices: true, ghost: false } });
    }
    app.select({ trackId: tr.id }); engine.muteOriginal = true;
    document.getElementById('blind-stop')?.classList.remove('hidden');
    await session.start({ trackId: tr.id, start: seg.start, end: seg.end }).catch((e) => toast(e.message, 'error'));
  }
  engine.muteOriginal = false;
  revealBlind(P, { players, segs, ready });
}

function revealBlind(P, { players, segs }) {
  const { engine } = app; const now = h('div.player-card#now-playing', '…');
  const off = engine.on('time', (tm) => { const i = segs.findIndex((s) => tm >= s.start && tm < s.end); if (i >= 0) { const w = i % players.length; now.innerHTML = ''; now.append(h('div.avatar', { style: { background: PLAYER_COLORS[w % 6] } }, String(w + 1)), h('div', h('div.small.dim', `${t('Segment')} ${i + 1}`), h('b', players[w]))); now.classList.add('cur'); } });
  const playBtn = h('button.primary.big-btn#reveal-play', { onclick: async () => { if (engine.playing) engine.pause(); else { engine.muteOriginal = false; await engine.play(0); } } }, '▶ ' + t('Play the chaotic reveal!'));
  P.setScreen(h('div.party-body', h('div.row', h('button.ghost', { onclick: () => P.hub() }, '← ' + t('Games')), h('h1', '🎬 ' + t('The chaotic reveal'))),
    h('div.party-stage', h('div.stage-box', P.stage.el), h('div.col', now, playBtn, h('button.big-btn#again', { onclick: () => blind(P) }, '🔁 ' + t('New round')), h('button.big-btn#reveal-export', { onclick: () => exportDialog() }, '⬆ ' + t('Export the video')), h('button.big-btn', { onclick: () => P.hub() }, '🏠 ' + t('More games'))))), { cleanup: () => { off(); engine.pause(); } });
  engine.seek(0);
}
