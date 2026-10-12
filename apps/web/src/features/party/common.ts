import { FX_INFO } from '@doblaje/audio';
import { type Cue, clamp, errorMessage, type FxPreset, newCue, newId, newTrack, pickColor, segmentsToCues, type TimeRange, type Track } from '@doblaje/core';
import { transcribeProject } from '@doblaje/speech';
import { h, icon, t, toast } from '@doblaje/ui';
import { api } from '../../api.ts';
import { app } from '../../app.ts';
import { mountVoice } from '../panels/voice.ts';

/** big modal with the full audio setup (mic, interface channel, headphones vs TV speakers, latency) */
export function audioSetupModal(): { close: () => void } {
  const back: HTMLElement = h('div.modal-back', {
    onclick: (e) => {
      if (e.target === back) close();
    },
  });
  const body = h('div.col');
  const m = mountVoice(body);
  const close = () => {
    m.destroy();
    back.remove();
  };
  back.append(h('div.modal', h('h2', t('Audio setup')), body, h('div.actions', h('button.primary', { id: 'audio-setup-done', onclick: close }, t('Done')))));
  document.body.append(back);
  return { close };
}

/** compact "is everything ready" strip shown on every party setup screen */
export function readyStrip(): { el: HTMLElement; destroy: () => void } {
  const fill = h('i');
  const meter = h('div.meter', { style: { width: '160px', height: '16px' } }, fill, h('b'));
  const chip = h('span.chip#party-mic-chip', app.mic.isOpen ? t('mic ready') : t('mic not open'));
  const el = h(
    'div.row',
    { id: 'ready-strip' },
    chip,
    meter,
    h('button#open-audio-setup', { onclick: () => audioSetupModal() }, icon('sliders'), t('Audio setup')),
    h('span.small.dim', app.project.settings.output === 'speakers' ? t('TV speakers: original sound is muted while you perform') : t('Headphones')),
  );
  const destroy = app.mic.on('level', (l) => {
    fill.style.width = `${clamp((Math.max(-60, l.peakDb ?? -120) + 60) / 60, 0, 1) * 100}%`;
    chip.textContent = t('mic ready');
    chip.className = 'chip ok';
  });
  return { el, destroy };
}

export async function ensureMic(): Promise<boolean> {
  if (app.mic.isOpen) return true;
  try {
    await app.engine.init();
    await app.engine.resume();
    await app.mic.open({ deviceId: app.mic.settings.deviceId });
    return true;
  } catch (e) {
    toast(t('Microphone error: {m}', { m: errorMessage(e) }), 'error');
    audioSetupModal();
    return false;
  }
}

export interface Busy {
  /** null/undefined leaves that part unchanged */
  set(title?: string | null, sub?: string | null, fraction?: number | null): void;
  close(): void;
}
export function busyOverlay(text: string): Busy {
  const label = h('div', { style: { fontSize: '1.25rem', fontWeight: '650' } }, text);
  const sub = h('div.dim', '');
  const bar = h('i');
  const prog = h('div.progress', { style: { width: '320px' } }, bar);
  const el = h('div.modal-back', { id: 'busy' }, h('div.modal', { style: { textAlign: 'center', width: 'min(520px,92vw)' } }, label, prog, sub));
  document.body.append(el);
  return {
    set(title, s, f) {
      if (title) label.textContent = title;
      if (s != null) sub.textContent = s;
      if (f != null) bar.style.width = `${f * 100}%`;
    },
    close: () => el.remove(),
  };
}

/** Get usable cues: existing ones, or transcribe the original dialogue with local Whisper. */
export async function ensureTranscript({
  language = 'auto',
  model = 'Xenova/whisper-base',
  busy,
}: {
  language?: string;
  model?: string;
  busy?: Busy;
} = {}): Promise<Cue[]> {
  const p = app.project;
  if (p.cues.some((c) => c.text?.trim())) return p.cues;
  busy?.set(t('Listening to the clip…'), t('Speech recognition runs on this computer'), 0.05);
  const r = await transcribeProject(p, {
    model,
    language,
    onProgress: (e) =>
      busy?.set(
        null,
        e.type === 'progress' ? `${t('Downloading model')} ${Math.round(e.pct * 100)}%` : t('Transcribing…'),
        e.type === 'progress' ? 0.05 + e.pct * 0.4 : 0.6,
      ),
  });
  if (!r.cues.length) throw new Error(t('No speech found in this clip. Try Bad Lip Reading, which does not need dialogue.'));
  app.store.commit(
    'Transcribe',
    (pr) => {
      pr.cues = r.cues.map((c) => newCue({ start: c.start, end: c.end, text: c.text }));
    },
    ['cues'],
  );
  return app.project.cues;
}

export interface Slot extends TimeRange {
  text: string;
}

/** slots for lines to write: transcript cues, else detected speech segments, else even chunks */
export async function makeSlots({ matchSounds, busy, language }: { matchSounds: boolean; busy?: Busy; language?: string }): Promise<Slot[]> {
  const p = app.project;
  const dur = p.media?.duration || 0;
  if (p.cues.length) return p.cues.map((c) => ({ start: c.start, end: c.end, text: matchSounds ? c.text : '' }));
  if (matchSounds && p.media?.hasAudio && dur <= 120) {
    try {
      const cues = await ensureTranscript({ language, busy });
      return cues.map((c) => ({ start: c.start, end: c.end, text: c.text }));
    } catch (e) {
      console.warn('stt skipped', errorMessage(e));
    }
  }
  try {
    const { segments } = await api.speechSegments(p.id);
    const covered = segments.reduce((a, s) => a + (s.end - s.start), 0);
    if (segments.length >= 2 && covered < dur * 0.92) return segmentsToCues(segments, { maxSec: 5 });
  } catch {}
  const n = Math.max(1, Math.round(dur / 3.2));
  return Array.from({ length: n }, (_, i) => ({ start: (dur * i) / n, end: (dur * (i + 1)) / n, text: '' }));
}

export interface ScriptLine {
  id: string;
  text: string;
  character?: string;
  direction?: string;
}
export function setScript(lines: ScriptLine[], slotsById: Map<string, TimeRange>): void {
  app.store.commit(
    'Party script',
    (p) => {
      p.cues = lines.flatMap((l) => {
        const s = slotsById.get(l.id);
        return s ? [newCue({ id: l.id, start: s.start, end: s.end, text: l.text, character: l.character || '', direction: l.direction || '' })] : [];
      });
    },
    ['cues'],
  );
}

/** make sure there's a track for this performer */
export function ensureTrack(name: string, { fx = 'none', index }: { fx?: FxPreset; index?: number } = {}): Track {
  if (!app.project.tracks.some((x) => x.name === name)) {
    app.store.commit(
      'Add performer',
      (p) => {
        p.tracks.push(newTrack({ name, index: index ?? p.tracks.length, fx }));
      },
      ['tracks'],
    );
  }
  return app.project.tracks.find((x) => x.name === name) as Track;
}

export const RANDOM_FX: FxPreset[] = ['none', 'walkie', 'monster', 'helium', 'ghost'];

/** speaking-drama score 0..100 from mic RMS dynamics while performing */
export class DramaMeter {
  readonly bar: HTMLElement;
  samples: number[] = [];
  smooth = 0;
  readonly #off: () => void;
  constructor(barEl: HTMLElement) {
    this.bar = barEl;
    this.#off = app.mic.on('level', (l) => {
      if (app.session.state !== 'recording') return;
      const db = Math.max(-70, l.rmsDb ?? -120);
      this.samples.push(db);
      const v = clamp((db + 55) / 40, 0, 1);
      this.smooth += (v - this.smooth) * 0.35;
      this.bar.style.width = `${this.smooth * 100}%`;
    });
  }
  score(): number {
    if (this.samples.length < 20) return 0;
    const s = [...this.samples].sort((a, b) => a - b);
    const q = (f: number) => s[Math.floor(s.length * f)];
    const range = q(0.95) - q(0.15);
    const loud = q(0.9);
    return Math.round(clamp(range / 30, 0, 1) * 55 + clamp((loud + 50) / 35, 0, 1) * 45);
  }
  destroy(): void {
    this.#off();
  }
}

export function trackFxPicker(onChange: (fx: FxPreset) => void, current: FxPreset = 'none'): HTMLElement {
  const grid = h(
    'div.fxgrid',
    ...Object.entries(FX_INFO).map(([k, v]) =>
      h(
        `button.fxbtn${k === current ? '.sel' : ''}`,
        {
          dataset: { fx: k },
          onclick: (e) => {
            for (const b of grid.querySelectorAll('.fxbtn')) b.classList.toggle('sel', b === e.currentTarget);
            onChange(k as FxPreset);
          },
        },
        t(v.label),
      ),
    ),
  );
  return grid;
}
export { newId, pickColor };
