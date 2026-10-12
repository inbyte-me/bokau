import { type AiTask, type Cue, clamp, errorMessage, type FxPreset, newCue, type TimeRange, type Track } from '@doblaje/core';
import { append, clear, fmtClock, getLang, h, icon, t, toast } from '@doblaje/ui';
import { rewriteCues } from '../../ai.ts';
import { api } from '../../api.ts';
import { app } from '../../app.ts';
import type { MountCtx, Mounted } from '../../main.ts';
import { toggleTv } from '../../tv.ts';
import { exportDialog } from '../export.ts';
import { Karaoke } from '../karaoke.ts';
import { saveControls, setFileActions } from '../save.ts';
import { Stage } from '../stage.ts';
import {
  audioSetupModal,
  type Busy,
  busyOverlay,
  DramaMeter,
  ensureMic,
  ensureTrack,
  ensureTranscript,
  makeSlots,
  RANDOM_FX,
  readyStrip,
  setScript,
  trackFxPicker,
} from './common.ts';
import { characterPicker } from './pick.ts';

/** State shared by the party screens. */
interface Party {
  root: HTMLElement;
  stage: Stage;
  kara: Karaoke | null;
  cleanups: (() => void)[];
  setScreen(el: HTMLElement, opts?: { cleanup?: () => void }): void;
  hub(): void;
  /** the mic/levels strip, torn down with the screen */
  strip(): HTMLElement;
}
const PLAYER_COLORS = ['#ff6b6b', '#4dd4ac', '#ffd166', '#6aa6ff', '#c792ea', '#ff9f68'];
const PREMISES = [
  'two people arguing about lost cheese',
  'a cooking show where everything catches fire',
  'a dramatic breakup over a WiFi password',
  'two spies who forgot the secret code',
  'a nature documentary about a very lazy cat',
];
const GENRES: [string, string, string][] = [
  ['noir', 'Noir Detective', 'Gritty inner monologue, 1940s slang, rain on the window.'],
  ['pirate', 'Pirate Swashbuckler', 'Nautical insults, treasure and the odd sea shanty.'],
  ['corporate', 'Bad Corporate Speak', 'Synergistic alignment and quarterly targets.'],
  ['action80s', '80s Action Movie', 'Every line ends with an explosion-ready one-liner.'],
];

export async function mount(root: HTMLElement, { topbar, go }: MountCtx): Promise<Mounted> {
  const { store, engine, session, mic } = app;
  const p = store.project;
  if (!p.party.configured)
    store.commit(
      'Party defaults',
      (pr) => {
        pr.party.configured = true;
        pr.settings.output = 'speakers';
        pr.settings.muteOriginalWhileRecording = true;
        pr.settings.preRoll = 3;
        pr.settings.preRollBeep = true;
        pr.ducking.enabled = false;
      },
      ['settings'],
    );
  const stage = new Stage();
  stage.showBanner(false);
  const loading = h('div.hint', { style: { padding: '2rem' } }, t('Loading…'));
  root.append(loading);
  await engine.load(store.project, stage.video);
  loading.remove();
  const body = h('div.party');
  root.append(body);
  const P: Party = {
    root: body,
    stage,
    kara: null,
    cleanups: [],
    setScreen(el, { cleanup } = {}) {
      for (const f of P.cleanups.splice(0)) {
        try {
          f();
        } catch {}
      }
      if (cleanup) P.cleanups.push(cleanup);
      clear(body);
      body.append(el);
    },
    hub: () => P.setScreen(hub(P)),
    strip() {
      const s = readyStrip();
      P.cleanups.push(s.destroy);
      return s.el;
    },
  };
  const title = h('span.small.dim', ` · ${p.name}`);
  const save = saveControls();
  const offFileActions = setFileActions({ export: () => exportDialog() });
  topbar.querySelector('.spacer')?.before(
    title,
    save.el,
    h(
      'button#party-hub',
      {
        onclick: () => {
          stopAll();
          P.hub();
        },
      },
      icon('home'),
      t('Games'),
    ),
    h('button.icon#party-audio', { title: t('Audio setup'), onclick: () => audioSetupModal() }, icon('sliders')),
  );
  const stopAll = () => {
    if (session.state !== 'idle') session.stop();
    if (engine.playing) engine.pause();
  };
  const onKey = (e: KeyboardEvent) => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    if (e.key === 'Escape') stopAll();
    if (e.key === 'f' || e.key === 'F') toggleTv();
  };
  window.addEventListener('keydown', onKey);
  const offTime = engine.on('time', (tm) => P.kara?.update(tm));
  const k = store.project.party.karaoke as KaraokeSetup | undefined;
  if (k?.characters) playCharacters(P, k, () => go('/party'));
  else P.hub();
  return {
    destroy: async () => {
      window.removeEventListener('keydown', onKey);
      save.destroy();
      offFileActions();
      offTime();
      stopAll();
      for (const f of P.cleanups) f();
      stage.destroy();
      engine.stop();
      await store.flush();
      mic.close();
    },
  };
}

// ---------------------------------------------------------------- hub
function hub(P: Party): HTMLElement {
  const p = app.project;
  const item = (key: string, id: string, title: string, desc: string, fn: () => void) =>
    h('li', h('button.item', { id: `mode-${id}`, onclick: fn }, h('span.k', key), h('span', h('h3', title), h('p', desc))));
  const prior = p.cues.length || p.tracks.some((x) => x.clips.length);
  const list: HTMLElement = h(
    'ul.running',
    {
      onkeydown: (e) => {
        const els = [...list.querySelectorAll<HTMLElement>('.item')];
        const i = els.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          els[Math.min(els.length - 1, i + 1)]?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          els[Math.max(0, i - 1)]?.focus();
        }
      },
    },
    item('A', 'badlip', t('Bad Lip Reading'), t('New lines written to fit the mouths on screen. You read them as they appear.'), () => badLip(P)),
    item('B', 'tele', t('Telenovela'), t('The scene’s dialogue rewritten as melodrama. You perform it.'), () => genreFlow(P, 'telenovela')),
    item('C', 'blind', t('Blind Dubbing'), t('Each player dubs a silent segment, seeing only the last second of the previous player.'), () => blind(P)),
    item('D', 'genre', t('Genre Swap'), t('The dialogue rewritten as noir, pirate, corporate or 80s action.'), () => genreSetup(P)),
    p.speakers.list.length
      ? item(
          'E',
          'characters',
          t('Play a character'),
          t('Pick who you play: their voice goes silent and their lines light up while the rest of the scene plays.'),
          () => characterSetup(P),
        )
      : null,
  );
  setTimeout(() => list.querySelector<HTMLElement>('.item')?.focus(), 0);
  return h(
    'div.party-body',
    h('div', h('h1', t('Games')), h('p.lead', t('One microphone, passed around. Up/Down and Enter to choose, F for TV mode.'))),
    list,
    h('div.signal-chain', P.strip()),
    prior
      ? h(
          'div.row',
          h('span.dim', t('This clip already has a script or recordings.')),
          h('button#party-replay', { onclick: () => reveal(P, { title: t('Replay') }) }, icon('play'), t('Replay')),
          h('button', { onclick: () => exportDialog() }, icon('export'), t('Export')),
        )
      : null,
  );
}

// ---------------------------------------------------------------- helpers
function shell(
  P: Party,
  { title, lead, form, primary, onBack }: { title: string; lead?: string; form: (HTMLElement | null)[]; primary: HTMLElement[]; onBack?: () => void },
): HTMLElement {
  return h(
    'div.party-body',
    h('div.row', h('button.ghost#back', { onclick: onBack || (() => P.hub()) }, t('Back')), h('h1', title)),
    lead ? h('div.lead', lead) : null,
    h(
      'div.row',
      { style: { alignItems: 'flex-start', gap: '1.5rem', flexWrap: 'wrap' } },
      h('div.col.grow', { style: { minWidth: '320px' } }, ...form),
      h('div', { style: { width: 'min(520px, 100%)' } }, h('div.stage-box.small', P.stage.el)),
    ),
    P.strip(),
    h('div.row', primary),
  );
}
async function prepareOriginal(busy: Busy | null, { keepMusic = true } = {}): Promise<boolean> {
  const pr = app.project;
  if (pr.media?.hasAudio && pr.stems.status === 'none') {
    busy?.set(t('Silencing the original actors…'), t('Separating dialogue from music + sound effects'), 0.1);
    try {
      const { job } = await api.startJob(`/api/projects/${pr.id}/stems`);
      await api.waitJob(job, (j) => busy?.set(null, `${Math.round(j.progress * 100)}%`, 0.1 + j.progress * 0.3));
      const fresh = await api.project(pr.id);
      app.store.refreshServerParts(fresh);
      if (fresh.stems.status === 'ready') await app.engine.assets?.loadStems();
    } catch (e) {
      console.warn('stems', e);
    }
  }
  const ready = app.project.stems.status === 'ready';
  app.store.commit(
    'Party audio',
    (p) => {
      p.original.source = ready && keepMusic ? 'bg' : 'full';
      p.original.mute = !ready || !keepMusic;
      p.original.volume = ready ? 0.75 : p.original.volume;
    },
    ['levels'],
  );
  return ready;
}
const LANG_NAMES: Record<string, string> = { en: 'English', es: 'Español', fr: 'Français' };
function langOptions(sel: string) {
  return Object.entries(LANG_NAMES).map(([v, name]) => h('option', { value: v, selected: v === sel }, name));
}
const defaultLang = () => (getLang() === 'es' ? 'es' : 'en');

// ---------------------------------------------------------------- A: bad lip reading
function badLip(P: Party): void {
  const prompt = h('input#prompt', { type: 'text', value: t(PREMISES[0]), style: { width: '100%' } });
  const lang = h('select#out-lang', ...langOptions(defaultLang()));
  const match = h('input#match-sounds', { type: 'checkbox', checked: (app.project.media?.duration || 0) <= 60 && !!app.project.media?.hasAudio });
  const chips = h(
    'div.row',
    { style: { flexWrap: 'wrap' } },
    ...PREMISES.map((s) =>
      h(
        'button.chip',
        {
          onclick: () => {
            prompt.value = t(s);
          },
        },
        t(s),
      ),
    ),
  );
  const go = h(
    'button.primary.big-btn#badlip-go',
    {
      onclick: async (): Promise<void> => {
        if (!(await ensureMic())) return;
        const busy = busyOverlay(t('Analyzing the clip…'));
        try {
          await prepareOriginal(busy, { keepMusic: true });
          busy.set(t('Finding where people talk…'), '', 0.4);
          const slots = await makeSlots({
            matchSounds: match.checked,
            busy,
            language: lang.value === 'es' ? 'spanish' : lang.value === 'fr' ? 'french' : 'english',
          });
          const slotCues = slots.map((s, i) => ({ id: `s${i}`, start: s.start, end: s.end, text: s.text }));
          busy.set(t('Writing lines…'), '', 0.7);
          const r = await rewriteCues('badlip', slotCues, { prompt: prompt.value, outLang: lang.value, fromLang: lang.value });
          setScript(r.lines, new Map(slotCues.map((c) => [c.id, c])));
          busy.close();
          if (r.notice) toast(r.notice, 'error');
          toast(r.source === 'ai' ? r.model || '' : t('offline generator'), 'ok');
          perform(P, { title: t('Bad Lip Reading'), trackName: t('Player'), drama: false, intro: t('Read each line as it highlights.') });
        } catch (e) {
          busy.close();
          toast(errorMessage(e), 'error');
        }
      },
    },
    t('Write script'),
  );
  P.setScreen(
    shell(P, {
      title: t('Bad Lip Reading'),
      lead: t('Describe what the scene is really about. Lines are written to match the syllables of each mouth movement.'),
      form: [
        h('div.field', h('label', t('What are they really talking about?')), prompt),
        chips,
        h('div.field', h('label', t('Language of the lines')), lang),
        h('label.row', match, t('Match the original sounds (runs speech recognition first; fits the lips better)')),
      ],
      primary: [go],
    }),
  );
}

// ---------------------------------------------------------------- B / D: transcript rewrite games
function genreSetup(P: Party): void {
  genreFlow(P, 'genre');
}
function genreFlow(P: Party, kind: 'genre' | 'telenovela'): void {
  let genre = 'noir';
  const lang = h('select#out-lang', ...langOptions(defaultLang()));
  const srtFile: HTMLInputElement = h('input', {
    type: 'file',
    accept: '.srt,.vtt',
    hidden: true,
    id: 'party-srt',
    onchange: async () => {
      const f = srtFile.files?.[0];
      if (!f) return;
      try {
        const { cues } = await api.raw<{ cues: { start: number; end: number; text: string; character?: string }[] }>(
          `/api/projects/${app.project.id}/import-subs`,
          f,
        );
        app.store.commit(
          'Import',
          (pr) => {
            pr.cues = cues.map((c) => newCue(c));
          },
          ['cues'],
        );
        toast(t('{n} cues imported', { n: cues.length }), 'ok');
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    },
  });
  const genreCards: HTMLElement = h(
    'ul.running',
    { style: { borderTop: '1px solid var(--line2)' } },
    ...GENRES.map(([id, name, desc]) =>
      h(
        'li',
        h(
          'button.item',
          {
            id: `genre-${id}`,
            dataset: { genre: id },
            style: { padding: '.6rem .6rem', boxShadow: id === genre ? 'inset 6px 0 0 var(--signal)' : '' },
            onclick: () => {
              genre = id;
              for (const c of genreCards.querySelectorAll<HTMLElement>('.item')) {
                c.style.boxShadow = c.dataset.genre === id ? 'inset 6px 0 0 var(--signal)' : '';
                const k = c.querySelector('.k');
                if (k) k.textContent = c.dataset.genre === id ? '•' : '';
              }
            },
          },
          h('span.k', { style: { fontSize: '1rem' } }, id === genre ? '•' : ''),
          h('span', h('h3', { style: { fontSize: '1.3rem' } }, t(name)), h('p', { style: { fontSize: '.95rem' } }, t(desc))),
        ),
      ),
    ),
  );
  const go = h(
    'button.primary.big-btn#genre-go',
    {
      onclick: async (): Promise<void> => {
        if (!(await ensureMic())) return;
        const busy = busyOverlay(t('Rewriting dialogue…'));
        try {
          await prepareOriginal(busy, { keepMusic: true });
          const cues = await ensureTranscript({ language: lang.value === 'es' ? 'spanish' : lang.value === 'fr' ? 'french' : 'auto', busy });
          busy.set(t('Rewriting dialogue…'), '', 0.8);
          const slotCues = cues.map((c) => ({ id: c.id, start: c.start, end: c.end, text: c.text, character: c.character }));
          const task: AiTask = kind === 'telenovela' ? 'telenovela' : 'genre';
          const r = await rewriteCues(task, slotCues, { genre, outLang: lang.value });
          setScript(r.lines, new Map(slotCues.map((c) => [c.id, c])));
          busy.close();
          if (r.notice) toast(r.notice, 'error');
          perform(P, {
            title: kind === 'telenovela' ? t('Telenovela Overdrive') : t(GENRES.find((g) => g[0] === genre)?.[1] || ''),
            trackName: t('Player'),
            drama: kind === 'telenovela',
            intro: kind === 'telenovela' ? t('Deliver each line with exaggerated emotion.') : t('Stay in character.'),
          });
        } catch (e) {
          busy.close();
          toast(errorMessage(e), 'error');
        }
      },
    },
    t('Rewrite dialogue'),
  );
  const form: HTMLElement[] = [
    h(
      'div.hint',
      app.project.cues.length
        ? t('{n} dialogue lines found.', { n: app.project.cues.length })
        : t('The dialogue will be transcribed automatically (or import subtitles).'),
    ),
    h('div.row', h('button', { onclick: () => srtFile.click() }, icon('file'), t('Import subtitles')), srtFile),
    h('div.field', h('label', t('Language')), lang),
  ];
  if (kind === 'genre') form.splice(0, 0, genreCards);
  P.setScreen(
    shell(P, {
      title: kind === 'telenovela' ? t('Telenovela') : t('Genre Swap'),
      lead: kind === 'telenovela' ? t('Every line is rewritten as soap-opera melodrama.') : t('Pick a genre. Timing is kept; the wording changes.'),
      form,
      primary: [go],
    }),
  );
}

// ---------------------------------------------------------------- shared perform screen
interface PerformOpts {
  title: string;
  trackName: string;
  drama: boolean;
  intro: string;
  /** the lines this performer reads (default: all) */
  lines?: Cue[];
  /** shown on the result screen: back to the clip list for the next invitee */
  next?: () => void;
}
function perform(P: Party, opts: PerformOpts): void {
  const { title, trackName, drama, intro } = opts;
  const { engine, session, store } = app;
  const cues = opts.lines || store.project.cues;
  const kara = new Karaoke(h('div.karaoke#karaoke'), { lead: 3, tail: 0.6, showWho: true, showDirection: true, idle: t('Waiting for the first line') });
  kara.el.classList.add('karaoke');
  P.kara = kara;
  const dramaBar = h('i');
  const meter = drama ? new DramaMeter(dramaBar) : null;
  const lineInfo = h('div.small.dim#line-info');
  const status = h('div.hint', intro);
  const fxPick = trackFxPicker((fx: FxPreset) => {
    const tr = ensureTrack(trackName, { fx });
    app.store.commit('Voice effect', () => {
      tr.fx = fx;
    }, ['tracks']);
  });
  const start = h('button.signal.big-btn#perform-start', { onclick: () => void run() }, t('Start'));
  const stop = h('button.big-btn#perform-stop', { onclick: () => session.stop() }, t('Finish'));
  const first = cues[0]?.start ?? 0;
  const startAt = Math.max(0, first - 3.5);
  const offs = [
    engine.on('time', (tm) => {
      const i = cues.findIndex((c) => tm >= c.start && tm < c.end);
      lineInfo.textContent = i >= 0 ? `${t('Line')} ${i + 1} / ${cues.length}` : '';
    }),
    session.on('state', (s) => {
      start.classList.toggle('hidden', s !== 'idle');
      stop.classList.toggle('hidden', s === 'idle');
    }),
  ];
  async function run() {
    if (!(await ensureMic())) return;
    const tr = ensureTrack(trackName, { fx: 'none' });
    app.select({ trackId: tr.id });
    kara.setCues(cues);
    const takes = await session.start({ trackId: tr.id, start: startAt, end: null }).catch((e: unknown) => {
      toast(errorMessage(e), 'error');
      return [];
    });
    if (takes.length) reveal(P, { title, score: meter?.score(), fromStart: startAt, again: () => perform(P, opts), next: opts.next });
    else status.textContent = t('Nothing recorded — try again.');
  }
  const screen = h(
    'div.party-body',
    h('div.row', h('button.ghost', { onclick: () => P.hub() }, t('Games')), h('h1', title), h('div.spacer'), lineInfo),
    h(
      'div.party-stage',
      h('div.col', h('div.stage-box', P.stage.el), kara.el),
      h(
        'div.col',
        status,
        drama ? h('div', h('div.small.dim', t('Intensity')), h('div.drama', dramaBar)) : null,
        h('div.small.dim', t('Voice effect')),
        fxPick,
        P.strip(),
        start,
        stop,
      ),
    ),
  );
  stop.classList.add('hidden');
  kara.el.classList.remove('hidden');
  P.setScreen(screen, {
    cleanup: () => {
      for (const f of offs) f();
      meter?.destroy();
      P.kara = null;
    },
  });
  engine.seek(startAt);
  kara.update(startAt);
  kara.el.classList.remove('hidden');
}

// ---------------------------------------------------------------- reveal / playback
function reveal(
  P: Party,
  { title, score, again, next, fromStart = 0 }: { title?: string; score?: number; again?: () => void; next?: () => void; fromStart?: number },
): void {
  const { engine } = app;
  const clock = h('div.mono', '');
  const playBtn = h(
    'button.primary.big-btn#reveal-play',
    {
      onclick: async () => {
        if (engine.playing) engine.pause();
        else {
          engine.muteOriginal = false;
          await engine.play(fromStart);
        }
      },
    },
    icon('play'),
    t('Play with recordings'),
  );
  const kara = new Karaoke(h('div.karaoke.hidden'), { lead: 0.3, tail: 0.5 });
  P.kara = kara;
  const offs = [
    engine.on('play', () => playBtn.replaceChildren(icon('pause'), t('Pause'))),
    engine.on('pause', () => playBtn.replaceChildren(icon('play'), t('Play with recordings'))),
    engine.on('time', (tm) => {
      clock.textContent = fmtClock(tm);
    }),
  ];
  const screen = h(
    'div.party-body',
    h('div.row', h('button.ghost', { onclick: () => P.hub() }, t('Games')), h('h1', `${t('Result')}${title ? ` — ${title}` : ''}`)),
    h(
      'div.party-stage',
      h('div.col', h('div.stage-box', P.stage.el), kara.el),
      h(
        'div.col',
        score != null ? h('div', h('div.lab', t('Drama score')), h('div.stat', { id: 'drama-score' }, String(score))) : null,
        playBtn,
        clock,
        next ? h('button.primary.big-btn#next-player', { onclick: next }, t('Next player')) : null,
        again ? h('button.big-btn#again', { onclick: again }, t('Record again')) : null,
        h('button.big-btn#reveal-export', { onclick: () => exportDialog() }, t('Export')),
        h('button.big-btn', { onclick: () => P.hub() }, t('Games')),
      ),
    ),
  );
  P.setScreen(screen, {
    cleanup: () => {
      for (const f of offs) f();
      engine.pause();
      P.kara = null;
    },
  });
  engine.seek(fromStart);
  kara.el.classList.remove('hidden');
}

// ---------------------------------------------------------------- C: blind dubbing
function blind(P: Party): void {
  const dur = app.project.media?.duration || 0;
  const players = [`${t('Player')} 1`, `${t('Player')} 2`, `${t('Player')} 3`];
  const nSel = h(
    'select#seg-count',
    ...[4, 5, 6].map((n) => h('option', { value: String(n), selected: n === clamp(Math.round(dur / 10), 4, 6) }, `${n} ${t('segments')}`)),
  );
  const silly = h('input#silly-fx', { type: 'checkbox', checked: true });
  const keep = h('input#keep-music', { type: 'checkbox', checked: true });
  const list = h('div.col#players');
  const renderPlayers = (): void => {
    clear(list);
    players.forEach((n, i) => {
      append(list, [
        h(
          'div.row',
          h('div.avatar', { style: { background: PLAYER_COLORS[i % 6] } }, String(i + 1)),
          h('input.grow', {
            type: 'text',
            value: n,
            id: `player-${i}`,
            oninput: (e) => {
              players[i] = e.target.value;
            },
          }),
          players.length > 2
            ? h(
                'button.ghost',
                {
                  onclick: () => {
                    players.splice(i, 1);
                    renderPlayers();
                  },
                },
                icon('close', 12),
              )
            : null,
        ),
      ]);
    });
    if (players.length < 6)
      list.append(
        h(
          'button#add-player',
          {
            onclick: () => {
              players.push(`${t('Player')} ${players.length + 1}`);
              renderPlayers();
            },
          },
          t('Add player'),
        ),
      );
  };
  renderPlayers();
  const go = h(
    'button.primary.big-btn#blind-go',
    {
      onclick: () =>
        void runBlind(P, {
          players: players.map((x, i) => x.trim() || `${t('Player')} ${i + 1}`),
          n: Number(nSel.value),
          silly: silly.checked,
          keepMusic: keep.checked,
        }),
    },
    t('Start'),
  );
  P.setScreen(
    shell(P, {
      title: t('Blind Dubbing'),
      lead: t(
        'Each player sees a silent segment and improvises. The next player only sees the last second of the previous performance — then continues the story!',
      ),
      form: [
        h('h4', t('Players')),
        list,
        h('div.field', h('label', t('Segments')), nSel),
        h('label.row', silly, t('Give every player a silly voice effect')),
        h('label.row', keep, t('Keep the original music + sound effects in the reveal (if separable)')),
      ],
      primary: [go],
    }),
  );
}

async function runBlind(P: Party, { players, n, silly, keepMusic }: { players: string[]; n: number; silly: boolean; keepMusic: boolean }): Promise<void> {
  const { engine, session, store } = app;
  if (!(await ensureMic())) return;
  const busy = busyOverlay(t('Setting up the game…'));
  await prepareOriginal(busy, { keepMusic });
  busy.close();
  const dur = engine.duration;
  const len = dur / n;
  const segs: TimeRange[] = Array.from({ length: n }, (_, i) => ({ start: i * len, end: (i + 1) * len }));
  const tracks: Track[] = players.map((name, i) => {
    const fx = silly ? RANDOM_FX[(i * 2 + 1) % RANDOM_FX.length] : 'none';
    const tr = ensureTrack(name, { fx: fx === 'none' && silly ? 'helium' : fx });
    store.commit('Reset player', () => {
      tr.clips = [];
      tr.takes = [];
      tr.color = PLAYER_COLORS[i % 6];
    }, ['tracks']);
    return tr;
  });
  store.commit(
    'Blind setup',
    (pr) => {
      pr.tracks = pr.tracks.filter((x) => tracks.some((tr) => tr.id === x.id));
      pr.cues = [];
      pr.party.blind = { players, segs };
    },
    ['tracks', 'cues'],
  );
  engine.muteOriginal = true;
  for (let i = 0; i < n; i++) {
    const who = i % players.length;
    const tr = store.project.tracks.find((x) => x.id === tracks[who].id) || tracks[who];
    const seg = segs[i];
    await new Promise<void>((resolve) => {
      const ready_ = h('button.primary.big-btn#pass-ready', { onclick: () => resolve() }, t('Ready'));
      const prevInfo =
        i > 0
          ? h('p.lead', `${t('You will first see the last second of')} ${players[(i - 1) % players.length]}${t("'s performance.")}`)
          : h('p.lead', t('You get the first segment. Start the story.'));
      P.setScreen(
        h(
          'div.party-body',
          h(
            'div.pass-screen',
            h('div.seg', `${t('Segment').toUpperCase()} ${i + 1} / ${n}`),
            h('h1', { style: { borderLeft: `10px solid ${PLAYER_COLORS[who % 6]}`, paddingLeft: '1rem' } }, `${t('Pass the mic to')} ${players[who]}`),
            h('p.lead', `${seg.end - seg.start > 12 ? `${t('about')} ` : ''}${Math.round(seg.end - seg.start)} s`),
            prevInfo,
            ready_,
          ),
        ),
      );
      ready_.focus();
    });
    P.setScreen(
      h(
        'div.party-body',
        h('div.row', h('h1', players[who]), h('div.spacer'), h('div.chip', `${t('Segment')} ${i + 1}/${n}`)),
        h('div.stage-box', P.stage.el),
        h('div.row', h('button.big-btn.hidden', { id: 'blind-stop', onclick: () => session.stop() }, t('Done'))),
        h('div.hint', t('The picture is silent — make up the dialogue!')),
      ),
    );
    if (i > 0) {
      // "previously": last second of the previous player's performance
      const ps = segs[i - 1];
      await engine.playRange(Math.max(ps.start, ps.end - 1), ps.end, { include: { original: false, voices: true, ghost: false } });
    }
    app.select({ trackId: tr.id });
    engine.muteOriginal = true;
    document.getElementById('blind-stop')?.classList.remove('hidden');
    await session.start({ trackId: tr.id, start: seg.start, end: seg.end }).catch((e: unknown) => toast(errorMessage(e), 'error'));
  }
  engine.muteOriginal = false;
  revealBlind(P, { players, segs });
}

function revealBlind(P: Party, { players, segs }: { players: string[]; segs: TimeRange[] }): void {
  const { engine } = app;
  const now = h('div.player-card#now-playing', '…');
  const off = engine.on('time', (tm) => {
    const i = segs.findIndex((s) => tm >= s.start && tm < s.end);
    if (i >= 0) {
      const w = i % players.length;
      now.replaceChildren(
        h('div.avatar', { style: { background: PLAYER_COLORS[w % 6] } }, String(w + 1)),
        h('div', h('div.small.dim', `${t('Segment')} ${i + 1}`), h('b', players[w])),
      );
      now.classList.add('cur');
    }
  });
  const playBtn = h(
    'button.primary.big-btn#reveal-play',
    {
      onclick: async () => {
        if (engine.playing) engine.pause();
        else {
          engine.muteOriginal = false;
          await engine.play(0);
        }
      },
    },
    icon('play'),
    t('Play result'),
  );
  P.setScreen(
    h(
      'div.party-body',
      h('div.row', h('button.ghost', { onclick: () => P.hub() }, t('Games')), h('h1', t('Result'))),
      h(
        'div.party-stage',
        h('div.stage-box', P.stage.el),
        h(
          'div.col',
          now,
          playBtn,
          h('button.big-btn#again', { onclick: () => blind(P) }, t('New round')),
          h('button.big-btn#reveal-export', { onclick: () => exportDialog() }, t('Export')),
          h('button.big-btn', { onclick: () => P.hub() }, t('Games')),
        ),
      ),
    ),
    {
      cleanup: () => {
        off();
        engine.pause();
      },
    },
  );
  engine.seek(0);
}

// ---------------------------------------------------------------- E: play a character (karaoke with the real scene)
export interface KaraokeSetup {
  /** speaker ids the performer plays */
  characters: string[];
  player: string;
}

/** Silence the chosen characters, show only their lines, record the performer over the rest of the scene. */
function playCharacters(P: Party, k: KaraokeSetup, next?: () => void): void {
  const p = app.project;
  const chosen = p.speakers.list.filter((s) => k.characters.includes(s.id));
  const names = new Set(chosen.map((s) => s.name));
  app.store.commit(
    'Party characters',
    (pr) => {
      for (const s of pr.speakers.list) {
        s.muted = k.characters.includes(s.id);
        s.solo = false;
      }
      pr.original.mute = false;
      pr.original.source = 'full';
      pr.settings.muteOriginalWhileRecording = false; // the scene must keep playing around you
    },
    ['speakers', 'settings', 'levels'],
  );
  void app.engine.refresh();
  const lines = p.cues.filter((c) => names.has(c.character));
  perform(P, {
    title: chosen.map((s) => s.name).join(' + ') || t('Play a character'),
    trackName: k.player || t('Player'),
    drama: false,
    intro: t('Your lines light up; everyone else in the scene plays as usual. Headphones keep the scene out of your microphone.'),
    lines: lines.length ? lines : p.cues,
    next,
  });
}

function characterSetup(P: Party): void {
  const picker = characterPicker(app.project.speakers.list, app.project.stems.status === 'ready');
  const go = h(
    'button.primary.big-btn#characters-go',
    {
      onclick: () => {
        const characters = picker.chosen();
        if (!characters.length) return toast(t('Pick at least one character'), 'error');
        playCharacters(P, { characters, player: picker.player() });
      },
    },
    t('Start'),
  );
  P.setScreen(
    shell(P, {
      title: t('Play a character'),
      lead: t('Pick who you play. Their voice goes silent and their lines light up.'),
      form: [picker.el],
      primary: [go],
    }),
  );
}
