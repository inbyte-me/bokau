import { type Cue, clamp, errorMessage, type TimeRange } from '@doblaje/core';
import { clear, fmtClock, h, icon, showMenu, t, toast } from '@doblaje/ui';
import { app } from '../app.ts';
import type { MountCtx, Mounted } from '../main.ts';
import { toggleTv } from '../tv.ts';
import { RhythmBand } from './band.ts';
import { openDevices } from './devices.ts';
import { exportDialog } from './export.ts';
import { deriveAndOpen } from './library.ts';
import { registerStudioMenus } from './menus.ts';
import { mountAi } from './panels/ai.ts';
import { mountCues } from './panels/cues.ts';
import { mountMarks } from './panels/marks.ts';
import { mountMix } from './panels/mix.ts';
import { mountRecord } from './panels/record.ts';
import { prepare, takePrepareRequest } from './prepare.ts';
import { saveControls, setFileActions } from './save.ts';
import { Stage } from './stage.ts';
import { Timeline } from './timeline.ts';

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['R', 'Record / stop (uses the “What to record” mode)'],
  ['Esc', 'Stop everything'],
  ['← →', 'Step one frame (Shift: one second)'],
  ['Home / End', 'Go to start / end'],
  ['⌘/Ctrl + 1…9', 'Set mark (Shift + 1…9 also works if the browser keeps ⌘+number)'],
  ['⌥/Option + 1…9', 'Jump to mark — keeps playing / recording / paused as it was'],
  ['[ / ]', 'Previous / next mark'],
  ['I / O', 'Set range in / out at the playhead'],
  ['L', 'Loop the selected cue or range'],
  ['S', 'Split the selected passage, cue or clip at the playhead'],
  ['Delete', 'Delete selected clip or cue'],
  ['M (hold)', 'Mark mouth-open while playing'],
  ['⌘/Ctrl + Z / ⇧Z', 'Undo / redo'],
  ['+ / −', 'Zoom the timeline'],
  ['F', 'TV mode'],
  ['?', 'This help'],
];
export function shortcutsModal(): void {
  const back: HTMLElement = h('div.modal-back', {
    onclick: (e) => {
      if (e.target === back) back.remove();
    },
  });
  back.append(
    h(
      'div.modal',
      { id: 'shortcuts' },
      h('h2', t('Keyboard shortcuts')),
      h(
        'div.col',
        ...SHORTCUTS.map(([k, d]) =>
          h(
            'div.row',
            h('div', { style: { minWidth: '11em' } }, ...k.split(' ').map((x) => (/^[+/…−]$|^or$/.test(x) ? ` ${x} ` : h('kbd', x)))),
            h('div.dim', t(d)),
          ),
        ),
      ),
      h('div.actions', h('button.primary', { onclick: () => back.remove() }, t('Close'))),
    ),
  );
  document.body.append(back);
}

type Panel = { destroy?(): void };
type RecordTarget = { err: string } | { start: number; end: number | null; loop?: boolean };

export async function mount(root: HTMLElement, { topbar, go }: MountCtx): Promise<Mounted> {
  const { store, engine, session, mic } = app;
  const p = store.project;
  const stage = new Stage();
  const bandCv = h('canvas.band#band');
  const band = new RhythmBand(bandCv);
  const status = h('div.hint#loading', t('Loading audio…'));
  root.append(status);
  try {
    await engine.load(p, stage.video);
  } catch (e) {
    status.textContent = errorMessage(e);
    throw e;
  }
  status.remove();
  stage.showBanner(localStorage.getItem('banner') !== '0');

  // ---- top bar extras ----
  const title = h('input.title#proj-title', {
    type: 'text',
    value: p.name,
    onchange: (e) =>
      store.commit(
        'Rename project',
        (pr) => {
          pr.name = e.target.value || pr.name;
        },
        ['meta'],
      ),
  });
  const save = saveControls();
  const offFileActions = setFileActions(p.template ? {} : { export: () => exportDialog() });
  const undoBtn = h(
    'button.icon#undo',
    {
      title: t('Undo (Ctrl/⌘+Z)'),
      onclick: () => {
        const l = store.undo();
        if (l) {
          void engine.refresh();
          toast(`${t('Undo')}: ${l}`);
        }
      },
    },
    icon('undo'),
  );
  const redoBtn = h(
    'button.icon#redo',
    {
      title: t('Redo'),
      onclick: () => {
        const l = store.redo();
        if (l) {
          void engine.refresh();
          toast(`${t('Redo')}: ${l}`);
        }
      },
    },
    icon('redo'),
  );
  topbar.querySelector('.spacer')?.before(
    title,
    undoBtn,
    redoBtn,
    save.el,
    p.template
      ? h(
          'span.chip.clip-badge#clip-badge',
          { title: t('A library clip: prepare dialogue, subtitles and characters here; record in projects started from it.') },
          t('Library clip'),
        )
      : h('span.hidden'),
    p.template
      ? h(
          'button.primary#use-clip',
          {
            onclick: (e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              showMenu(
                [
                  { label: t('New dubbing project from this clip'), icon: 'mic', run: () => void store.save().then(() => deriveAndOpen(p.id, 'pro', go)) },
                  { label: t('New party project from this clip'), icon: 'tv', run: () => void store.save().then(() => deriveAndOpen(p.id, 'party', go)) },
                  { label: t('New podcast project from this clip'), icon: 'wave', run: () => void store.save().then(() => deriveAndOpen(p.id, 'podcast', go)) },
                ],
                r.left,
                r.bottom + 2,
              );
            },
          },
          icon('plus'),
          t('Start a project'),
        )
      : h('button.primary#export-btn', { onclick: () => exportDialog() }, icon('export'), t('Export')),
    h('button.icon#help-btn', { title: t('Keyboard shortcuts (?)'), onclick: shortcutsModal }, icon('keys')),
  );

  // ---- transport ----
  const clock = h('div.clock#clock', '00:00.000');
  const lenEl = h('span.dim.mono', ` / ${fmtClock(p.media?.duration || 0)}`);
  const playBtn = h('button.icon#play', { title: t('Play / pause (Space)'), onclick: () => void togglePlay() }, icon('play'));
  const recBtn = h('button.icon.rec#rec', { title: t('Record (R)'), onclick: () => void toggleRecord() }, icon('rec'));
  if (p.template) recBtn.classList.add('hidden'); // clips are prepared, not recorded on
  const recMode = h(
    'select#rec-mode',
    { title: t('What to record') },
    ...[
      ['playhead', t('From playhead')],
      ['cue', t('Selected cue')],
      ['region', t('Punch range')],
      ['loop', t('Loop takes (cue/range)')],
    ].map(([v, l]) => h('option', { value: v }, l)),
  );
  const loopBtn = h('button.icon#loop-play', { title: t('Loop playback of the selected range (L)'), onclick: () => tl.loopFromSelection() }, icon('loop'));
  const miniFill = h('i');
  const miniMeter = h('div.meter', miniFill, h('b'));
  const micBtn = h('span.chip#mic-chip', t('mic closed'));
  const transport = h(
    'div.transport',
    h(
      'div.grp',
      h('button.icon#to-start', { title: t('Go to start (Home)'), onclick: () => engine.seek(0) }, icon('start')),
      h('button.icon', { title: t('Back one frame (←)'), onclick: () => engine.stepFrame(-1) }, icon('stepBack')),
      playBtn,
      h('button.icon', { title: t('Forward one frame (→)'), onclick: () => engine.stepFrame(1) }, icon('stepFwd')),
      h(
        'button.icon#stop',
        {
          title: t('Stop'),
          onclick: () => {
            stopAll();
            engine.seek(p.loop?.start ?? 0);
          },
        },
        icon('stop'),
      ),
    ),
    h('div.sep'),
    recBtn,
    recMode,
    loopBtn,
    h('div.sep'),
    clock,
    lenEl,
    h('div.spacer'),
    micBtn,
    miniMeter,
    h('div.sep'),
    h('span.dim.small', t('Take:')),
    h('span.chip#track-chip', ''),
  );
  const timeline = h('div.timeline');
  const tl = new Timeline(timeline);

  // ---- side panels ----
  // Tabs follow the workflow: script (subtitles), voices (separation + who speaks), marks, record, mix, AI.
  const tabsDef: [string, string, (r: HTMLElement) => Panel][] = [
    ['cues', t('Script'), mountCues],
    ['voices', t('Voices'), (r) => mountMix(r, { band, stage, part: 'voices' })],
    ['marks', t('Marks'), (r) => mountMarks(r, { setMark, jumpMark: (n) => void jumpMark(n) })],
    ...(p.template ? [] : [['record', t('Record'), mountRecord] as [string, string, (r: HTMLElement) => Panel]]),
    ['mix', t('Mix'), (r) => mountMix(r, { band, stage })],
    ['ai', t('AI'), mountAi],
  ];
  const panel = h('div.panel#panel');
  const tabs = h('div.tabs');
  let curPanel: Panel | null = null;
  const showTab = (id: string) => {
    curPanel?.destroy?.();
    clear(panel);
    const d = tabsDef.find((x) => x[0] === id) || tabsDef[0];
    curPanel = d[2](panel);
    for (const b of tabs.querySelectorAll<HTMLElement>('.tab')) b.classList.toggle('sel', b.dataset.tab === id);
    try {
      sessionStorage.setItem('tab', id);
    } catch {}
  };
  for (const [id, label] of tabsDef) tabs.append(h('button.tab', { dataset: { tab: id }, id: `tab-${id}`, onclick: () => showTab(id) }, label));
  const side = h('div.side', tabs, panel);
  const studioEl = h('div.studio', h('div.stage-wrap', stage.el, bandCv), side, transport, timeline);
  root.append(studioEl);
  const savedTab = (() => {
    try {
      return sessionStorage.getItem('tab');
    } catch {
      return null;
    }
  })();
  const prepareLang = takePrepareRequest(p.id);
  showTab(prepareLang ? 'voices' : savedTab && tabsDef.some((d) => d[0] === savedTab) ? savedTab : p.cues.length ? 'cues' : 'voices');
  if (prepareLang) void prepare.run(['separate', 'subtitles', 'speakers'], prepareLang);

  // ---- behaviour ----
  function stopAll() {
    if (session.state !== 'idle') session.stop();
    if (engine.playing) engine.pause();
  }
  async function togglePlay(): Promise<void> {
    if (session.state !== 'idle') {
      session.stop();
      return;
    }
    if (engine.playing) {
      engine.pause();
      return;
    }
    const loop = store.project.loop;
    if (loop && engine.time >= loop.start - 0.01 && engine.time < loop.end) await engine.playAt(engine.time, undefined, { to: loop.end });
    else if (loop) await engine.playAt(loop.start, undefined, { to: loop.end });
    else await engine.play();
  }
  engine.on('ended', () => {
    // loop playback (recording sessions handle their own end)
    const loop = store.project.loop;
    if (session.state !== 'idle' || !engine.playing || !loop) return;
    void engine.playAt(loop.start, undefined, { to: loop.end });
  });
  function recordTarget(): RecordTarget {
    const mode = recMode.value;
    const cue = p.cues.find((c) => c.id === app.sel.cueId);
    const region = app.sel.region;
    if (mode === 'cue') {
      if (!cue) return { err: t('Select a cue first (click it in the Cues tab or the cue lane)') };
      return { start: Math.max(0, cue.start - 0.05), end: Math.min(engine.duration, cue.end + 0.25) };
    }
    if (mode === 'region') {
      if (!region) return { err: t('Shift+drag on the timeline to choose the range to re-record') };
      return { start: region.start, end: region.end };
    }
    if (mode === 'loop') {
      const r: TimeRange | null =
        region || (cue ? { start: Math.max(0, cue.start - 0.05), end: Math.min(engine.duration, cue.end + 0.25) } : null) || store.project.loop;
      if (!r) return { err: t('Select a cue or Shift+drag a range to loop-record') };
      return { ...r, loop: true };
    }
    return { start: engine.time, end: null };
  }
  async function toggleRecord(override?: RecordTarget): Promise<void> {
    if (session.state !== 'idle') {
      session.stop();
      return;
    }
    if (p.template) {
      toast(t('Clips are not recorded on. Start a project from this clip to record.'), 'info', 3500);
      return;
    }
    if (!mic.isOpen) {
      toast(t('Choose and open your microphone first'), 'error');
      openDevices();
      return;
    }
    const tr = app.track;
    const tgt = override || recordTarget();
    if ('err' in tgt) {
      toast(tgt.err, 'error');
      return;
    }
    try {
      const takes = await session.start({ trackId: tr.id, start: tgt.start, end: tgt.end, loop: !!tgt.loop, cueId: app.sel.cueId });
      if (takes.length) toast(t('{n} take(s) recorded on “{track}”', { n: takes.length, track: tr.name }), 'ok');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
  const offRecordCue = app.on('record-cue', (cue: Cue, loop?: boolean) => {
    recMode.value = loop ? 'loop' : 'cue';
    app.select({ cueId: cue.id });
    void toggleRecord();
  });

  const offs = [
    engine.on('time', (tm) => {
      clock.textContent = fmtClock(tm, { ms: true });
    }),
    engine.on('play', () => playBtn.replaceChildren(icon('pause'))),
    engine.on('pause', () => playBtn.replaceChildren(icon('play'))),
    session.on('state', (s) => {
      recBtn.classList.toggle('on', s === 'recording' || s === 'countdown');
      studioEl.classList.toggle('recording', s === 'recording');
      playBtn.disabled = false;
      tl.invalidate();
    }),
    mic.on('level', (l) => {
      const f = clamp((Math.max(-60, l.peakDb ?? -120) + 60) / 60, 0, 1);
      miniFill.style.width = `${f * 100}%`;
      micBtn.textContent = t('mic on');
      micBtn.className = 'chip ok';
    }),
    app.on('selection', () => {
      trackChip();
    }),
    store.on('change', () => {
      undoBtn.disabled = !store.undoStack.length;
      redoBtn.disabled = !store.redoStack.length;
      trackChip();
    }),
  ];
  const trackChip = () => {
    const el = transport.querySelector<HTMLElement>('#track-chip');
    const tr = app.track;
    if (!el) return;
    el.textContent = tr?.name || '';
    el.style.color = tr?.color || '';
  };
  trackChip();
  undoBtn.disabled = true;
  redoBtn.disabled = true;

  // ---- marks: ⌘/Ctrl+digit (or Shift+digit) sets, ⌥/Option+digit jumps; keeps playing/recording/paused state ----
  const fmtMark = (tm: number) => fmtClock(tm, { ms: true });
  function setMark(n: number, tm = engine.time) {
    store.commit(
      'Set mark',
      (pr) => {
        pr.markers = (pr.markers || []).filter((m) => m.n !== n);
        pr.markers.push({ id: `m${n}`, n, t: tm });
        pr.markers.sort((a, b) => a.n - b.n);
      },
      ['markers'],
    );
    toast(`${t('Mark')} ${n} · ${fmtMark(tm)}`, 'ok', 1500);
  }
  async function jumpMark(n: number) {
    const m = (store.project.markers || []).find((x) => x.n === n);
    if (!m) {
      toast(`${t('No mark')} ${n} — ${t('set one with ⌘/Ctrl+number')}`, 'error', 2200);
      return;
    }
    if (session.state !== 'idle') await session.jump(m.t);
    else engine.seek(m.t); // seek keeps a paused transport paused and a playing one playing
  }
  offs.push(
    app.on('jump-mark', (n: number) => void jumpMark(n)),
    offRecordCue,
    app.on('show-tab', (id: string) => showTab(id)),
    registerStudioMenus({
      tl,
      record: (target) => void toggleRecord(target),
      setMark,
      jumpMark: (n) => void jumpMark(n),
      deleteMark: (n) => app.emit('delete-mark', n),
      toggleBanner: () => {
        const on = localStorage.getItem('banner') === '0';
        try {
          localStorage.setItem('banner', on ? '1' : '0');
        } catch {}
        stage.showBanner(on);
      },
      toggleTv: () => toggleTv(),
    }),
    app.on('delete-mark', (n: number) =>
      store.commit(
        'Delete mark',
        (pr) => {
          pr.markers = pr.markers.filter((m) => m.n !== n);
        },
        ['markers'],
      ),
    ),
  );

  // lip-flap tapping with the M key: hold while the mouth is open
  let tapStart: number | null = null;
  const onKey = (e: KeyboardEvent) => {
    const tag = document.activeElement?.tagName || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) && e.key !== 'Escape') return;
    const mod = e.metaKey || e.ctrlKey;
    const dg = /^(?:Digit|Numpad)(\d)$/.exec(e.code || '');
    if (dg) {
      // e.code, because Option+digit types symbols on macOS
      const n = Number(dg[1]);
      if (mod || (e.shiftKey && !e.altKey)) {
        e.preventDefault();
        setMark(n);
        return;
      }
      if (e.altKey) {
        e.preventDefault();
        void jumpMark(n);
        return;
      }
    }
    if (e.key === ' ') {
      e.preventDefault();
      void togglePlay();
    } else if (e.key === 'r' || e.key === 'R') {
      if (!mod) {
        e.preventDefault();
        void toggleRecord();
      }
    } else if (e.key === 'Escape') {
      stopAll();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (e.shiftKey) engine.seek(engine.time - 1);
      else engine.stepFrame(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.shiftKey) engine.seek(engine.time + 1);
      else engine.stepFrame(1);
    } else if ((e.key === '[' || e.key === ']') && !mod) {
      // previous / next mark, in time order (keeps the transport state, like ⌥+number)
      const now = engine.time;
      const sorted = [...store.project.markers].sort((a, b) => a.t - b.t);
      const m = e.key === ']' ? sorted.find((x) => x.t > now + 0.05) : sorted.reverse().find((x) => x.t < now - 0.05);
      if (m) void jumpMark(m.n);
    } else if (e.key === 'Home') engine.seek(0);
    else if (e.key === 'End') engine.seek(engine.duration);
    else if ((e.key === 'z' || e.key === 'Z') && mod) {
      e.preventDefault();
      (e.shiftKey ? redoBtn : undoBtn).click();
    } else if (e.key === 'y' && mod) {
      e.preventDefault();
      redoBtn.click();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (tl.deleteSelected()) e.preventDefault();
    } else if ((e.key === 's' || e.key === 'S') && !mod) {
      if (!tl.splitAtPlayhead()) toast(t('Nothing to split at the playhead'), 'info', 1500);
    } else if (e.key === 'l' || e.key === 'L') tl.loopFromSelection();
    else if (e.key === '=' || e.key === '+') tl.zoom(1.4);
    else if (e.key === '-') tl.zoom(0.7);
    else if (e.key === 'i' || e.key === 'I') {
      const end0 = app.sel.region?.end;
      app.sel.region = { start: engine.time, end: end0 != null && end0 > engine.time ? end0 : Math.min(engine.duration, engine.time + 2) };
      tl.invalidate();
      app.emit('selection', app.sel);
    } else if (e.key === 'o' || e.key === 'O') {
      const s = app.sel.region?.start ?? Math.max(0, engine.time - 2);
      app.sel.region = { start: Math.min(s, engine.time - 0.1), end: engine.time };
      tl.invalidate();
      app.emit('selection', app.sel);
    } else if (e.key === '?') shortcutsModal();
    else if ((e.key === 'f' || e.key === 'F') && !mod) toggleTv();
    else if ((e.key === 'm' || e.key === 'M') && !e.repeat && engine.playing && tapStart == null) tapStart = engine.time;
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if ((e.key === 'm' || e.key === 'M') && tapStart != null) {
      const s = tapStart,
        en = engine.time;
      tapStart = null;
      if (en - s > 0.04)
        store.commit(
          'Tap lip flap',
          (pr) => {
            pr.lipFlaps.push({ start: s, end: en });
            pr.lipFlaps.sort((a, b) => a.start - b.start);
          },
          ['flaps'],
        );
    }
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  return {
    async destroy() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      for (const f of offs) f();
      save.destroy();
      offFileActions();
      curPanel?.destroy?.();
      tl.destroy();
      band.destroy();
      stage.destroy();
      if (session.state !== 'idle') session.stop();
      engine.stop();
      await store.flush();
      mic.close();
    },
  };
}
