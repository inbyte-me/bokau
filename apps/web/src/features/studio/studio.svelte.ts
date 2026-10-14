// The studio's behaviour, apart from its markup: transport, recording targets, marks, the keyboard, which panel is
// open. Studio.svelte creates one per open project and shares it with its children through context.
import { type Cue, errorMessage, type TimeRange } from '@doblaje/core';
import { fmtClock, t, toast } from '@doblaje/ui';
import { createContext } from 'svelte';
import { app } from '../../app.svelte.ts';
import { toggleTv } from '../../tv.ts';
import type { RhythmBand } from '../band.ts';
import { openDevices } from '../devices/devices.svelte.ts';
import type { Timeline } from '../timeline.ts';

export type RecMode = 'playhead' | 'cue' | 'region' | 'loop';
export type RecordTarget = { err: string } | { start: number; end: number | null; loop?: boolean };
export type TabId = 'cues' | 'voices' | 'marks' | 'record' | 'mix' | 'ai';

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export class StudioState {
  /** the open side panel */
  tab = $state<TabId>('cues');
  /** what R records */
  recMode = $state<RecMode>('playhead');
  /** the karaoke line over the picture */
  banner = $state(read('banner') !== '0');
  showHelp = $state(false);
  /** canvas engines, set by their components once mounted */
  tl = $state.raw<Timeline | null>(null);
  band = $state.raw<RhythmBand | null>(null);
  #tapStart: number | null = null;

  setTab(id: TabId): void {
    this.tab = id;
    try {
      sessionStorage.setItem('tab', id);
    } catch {}
  }
  toggleBanner(on = !this.banner): void {
    this.banner = on;
    write('banner', on ? '1' : '0');
  }

  // ---------------------------------------------------------------- transport
  stopAll(): void {
    if (app.session.state !== 'idle') app.session.stop();
    if (app.engine.playing) app.engine.pause();
  }
  async togglePlay(): Promise<void> {
    const { engine, session, store } = app;
    if (session.state !== 'idle') return session.stop();
    if (engine.playing) return engine.pause();
    const loop = store.project.loop;
    if (loop && engine.time >= loop.start - 0.01 && engine.time < loop.end) await engine.playAt(engine.time, undefined, { to: loop.end });
    else if (loop) await engine.playAt(loop.start, undefined, { to: loop.end });
    else await engine.play();
  }
  /** loop playback when a loop range is set (recording sessions handle their own end) */
  onEnded(): void {
    const { engine, session, store } = app;
    const loop = store.current?.loop;
    if (session.state !== 'idle' || !engine.playing || !loop) return;
    void engine.playAt(loop.start, undefined, { to: loop.end });
  }

  // ---------------------------------------------------------------- recording
  recordTarget(): RecordTarget {
    const { engine, store } = app;
    const cue = store.project.cues.find((c) => c.id === app.sel.cueId);
    const region = app.sel.region;
    if (this.recMode === 'cue') {
      if (!cue) return { err: t('Select a cue first (click it in the Cues tab or the cue lane)') };
      return { start: Math.max(0, cue.start - 0.05), end: Math.min(engine.duration, cue.end + 0.25) };
    }
    if (this.recMode === 'region') {
      if (!region) return { err: t('Shift+drag on the timeline to choose the range to re-record') };
      return { start: region.start, end: region.end };
    }
    if (this.recMode === 'loop') {
      const r: TimeRange | null =
        region || (cue ? { start: Math.max(0, cue.start - 0.05), end: Math.min(engine.duration, cue.end + 0.25) } : null) || store.project.loop;
      if (!r) return { err: t('Select a cue or Shift+drag a range to loop-record') };
      return { ...r, loop: true };
    }
    return { start: engine.time, end: null };
  }
  async toggleRecord(override?: RecordTarget): Promise<void> {
    const { session, store, mic } = app;
    if (session.state !== 'idle') return session.stop();
    if (store.project.template) {
      toast(t('Clips are not recorded on. Start a project from this clip to record.'), 'info', 3500);
      return;
    }
    if (!mic.isOpen) {
      toast(t('Choose and open your microphone first'), 'error');
      openDevices();
      return;
    }
    const tr = app.track;
    const tgt = override || this.recordTarget();
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
  /** a cue's "Record this cue" (menus, the Script panel) */
  recordCue(cue: Cue, loop = false): void {
    this.recMode = loop ? 'loop' : 'cue';
    app.select({ cueId: cue.id });
    void this.toggleRecord();
  }

  // ---------------------------------------------------------------- marks
  setMark(n: number, tm = app.engine.time): void {
    app.store.commit(
      'Set mark',
      (pr) => {
        pr.markers = (pr.markers || []).filter((m) => m.n !== n);
        pr.markers.push({ id: `m${n}`, n, t: tm });
        pr.markers.sort((a, b) => a.n - b.n);
      },
      ['markers'],
    );
    toast(`${t('Mark')} ${n} · ${fmtClock(tm, { ms: true })}`, 'ok', 1500);
  }
  async jumpMark(n: number): Promise<void> {
    const m = (app.store.project.markers || []).find((x) => x.n === n);
    if (!m) {
      toast(`${t('No mark')} ${n} — ${t('set one with ⌘/Ctrl+number')}`, 'error', 2200);
      return;
    }
    if (app.session.state !== 'idle') await app.session.jump(m.t);
    else app.engine.seek(m.t); // seek keeps a paused transport paused and a playing one playing
  }
  deleteMark(n: number): void {
    app.store.commit(
      'Delete mark',
      (pr) => {
        pr.markers = pr.markers.filter((m) => m.n !== n);
      },
      ['markers'],
    );
  }

  // ---------------------------------------------------------------- undo
  undo(): void {
    const l = app.store.undo();
    if (l) {
      void app.engine.refresh();
      toast(`${t('Undo')}: ${l}`);
    }
  }
  redo(): void {
    const l = app.store.redo();
    if (l) {
      void app.engine.refresh();
      toast(`${t('Redo')}: ${l}`);
    }
  }

  // ---------------------------------------------------------------- keyboard (see SHORTCUTS)
  keydown(e: KeyboardEvent): void {
    const { engine, store } = app;
    const tl = this.tl;
    const tag = document.activeElement?.tagName || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) && e.key !== 'Escape') return;
    if (this.showHelp && e.key !== '?') return;
    const mod = e.metaKey || e.ctrlKey;
    const dg = /^(?:Digit|Numpad)(\d)$/.exec(e.code || ''); // e.code: Option+digit types symbols on macOS
    if (dg) {
      const n = Number(dg[1]);
      if (mod || (e.shiftKey && !e.altKey)) {
        e.preventDefault();
        this.setMark(n);
        return;
      }
      if (e.altKey) {
        e.preventDefault();
        void this.jumpMark(n);
        return;
      }
    }
    if (e.key === ' ') {
      e.preventDefault();
      void this.togglePlay();
    } else if ((e.key === 'r' || e.key === 'R') && !mod) {
      e.preventDefault();
      void this.toggleRecord();
    } else if (e.key === 'Escape') this.stopAll();
    else if (e.key === 'ArrowLeft') {
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
      if (m) void this.jumpMark(m.n);
    } else if (e.key === 'Home') engine.seek(0);
    else if (e.key === 'End') engine.seek(engine.duration);
    else if ((e.key === 'z' || e.key === 'Z') && mod) {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (e.key === 'y' && mod) {
      e.preventDefault();
      this.redo();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (tl?.deleteSelected()) e.preventDefault();
    } else if ((e.key === 's' || e.key === 'S') && !mod) {
      if (!tl?.splitAtPlayhead()) toast(t('Nothing to split at the playhead'), 'info', 1500);
    } else if (e.key === 'l' || e.key === 'L') tl?.loopFromSelection();
    else if (e.key === '=' || e.key === '+') tl?.zoom(1.4);
    else if (e.key === '-') tl?.zoom(0.7);
    else if (e.key === 'i' || e.key === 'I') {
      const end0 = app.sel.region?.end;
      app.sel.region = { start: engine.time, end: end0 != null && end0 > engine.time ? end0 : Math.min(engine.duration, engine.time + 2) };
      tl?.invalidate();
      app.emit('selection', app.sel);
    } else if (e.key === 'o' || e.key === 'O') {
      const s = app.sel.region?.start ?? Math.max(0, engine.time - 2);
      app.sel.region = { start: Math.min(s, engine.time - 0.1), end: engine.time };
      tl?.invalidate();
      app.emit('selection', app.sel);
    } else if (e.key === '?') this.showHelp = !this.showHelp;
    else if ((e.key === 'f' || e.key === 'F') && !mod) toggleTv();
    else if ((e.key === 'm' || e.key === 'M') && !e.repeat && engine.playing && this.#tapStart == null) this.#tapStart = engine.time;
  }
  /** lip-flap tapping: hold M while the mouth is open */
  keyup(e: KeyboardEvent): void {
    if ((e.key === 'm' || e.key === 'M') && this.#tapStart != null) {
      const s = this.#tapStart;
      const en = app.engine.time;
      this.#tapStart = null;
      if (en - s > 0.04)
        app.store.commit(
          'Tap lip flap',
          (pr) => {
            pr.lipFlaps.push({ start: s, end: en });
            pr.lipFlaps.sort((a, b) => a.start - b.start);
          },
          ['flaps'],
        );
    }
  }
}

export const [getStudio, setStudio] = createContext<StudioState>();

/** Keyboard shortcuts, as shown in the help dialog (keys, then what they do). */
export const SHORTCUTS: [string, string][] = [
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
