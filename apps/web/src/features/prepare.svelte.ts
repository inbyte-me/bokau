// "Prepare this clip": the three steps almost every dub needs, in order, with one button.
//   1. separate dialogue from music (so voices can be silenced and analysed cleanly)
//   2. subtitles (speech recognition on the dialogue)
//   3. speakers (who speaks when; each becomes a character lane; cues get the character's name)
// Runs from the Voices tab (PrepareChecklist.svelte), or right after import when the new-project dialog asked for
// it. Progress lives here (not in the panel), so switching tabs never loses it.
import { dominantSpeaker, errorMessage, newCue } from '@doblaje/core';
import { identifySpeakers, transcribeProject } from '@doblaje/speech';
import { t } from '@doblaje/ui';
import { api } from '../api.ts';
import { app } from '../app.svelte.ts';

export type StepId = 'separate' | 'subtitles' | 'speakers';
export type StepState = 'todo' | 'running' | 'done' | 'skipped' | 'error';
export interface StepStatus {
  state: StepState;
  message: string;
}
export const STEPS: { id: StepId; label: string; hint: string }[] = [
  { id: 'separate', label: 'Separate dialogue from music', hint: 'Keeps the score and effects when you silence a voice.' },
  { id: 'subtitles', label: 'Subtitles', hint: 'Speech recognition on this computer; the lines become cues.' },
  { id: 'speakers', label: 'Speakers', hint: 'Finds each voice and gives it its own lane; cues get the character name.' },
];
export const LANGS: [string, string][] = [
  ['auto', 'Auto-detect'],
  ['spanish', 'Español'],
  ['english', 'English'],
  ['french', 'Français'],
  ['portuguese', 'Português'],
  ['german', 'Deutsch'],
  ['italian', 'Italiano'],
];

/** Whether a step is already satisfied by the open project. */
export function stepDone(id: StepId): boolean {
  const p = app.project;
  if (id === 'separate') return p.stems.status === 'ready';
  if (id === 'subtitles') return p.cues.some((c) => c.text.trim());
  return p.speakers.list.length > 0;
}

// ---------------------------------------------------------------- the steps (also used by single buttons)
export async function separateDialogue(say: (m: string) => void = () => {}): Promise<'ready' | 'unsupported'> {
  const run = async (method: 'auto' | 'neural') => {
    const { job } = await api.startJob(`/api/projects/${app.project.id}/stems`, { method });
    await api.waitJob(job, (j) => say(`${j.message || t('Separating')} ${Math.round(j.progress * 100)}%`), { intervalMs: 700 });
    const fresh = await api.project(app.project.id);
    app.store.refreshServerParts(fresh);
    return fresh.stems;
  };
  let stems = await run('auto');
  if (stems.status === 'unsupported' && stems.neuralAvailable) {
    say(t('Mono clip: using the neural separator (about as long as the clip)…'));
    stems = await run('neural');
  }
  if (stems.status !== 'ready') return 'unsupported';
  await app.engine.assets?.loadStems();
  app.store.commit(
    'Stems',
    (pr) => {
      pr.original.source = 'full';
    },
    ['levels'],
  );
  void app.engine.refresh();
  return 'ready';
}

export async function makeSubtitles(language: string, say: (m: string) => void = () => {}): Promise<number> {
  const r = await transcribeProject(app.project, {
    model: 'Xenova/whisper-base',
    language,
    onProgress: (e) => say(e.type === 'progress' ? `${t('Downloading model')} ${Math.round(e.pct * 100)}%` : t('Transcribing…')),
  });
  if (!r.cues.length) return 0;
  app.store.commit(
    'Transcribe',
    (pr) => {
      pr.cues = r.cues.map((c) => newCue({ start: c.start, end: c.end, text: c.text }));
    },
    ['cues'],
  );
  return r.cues.length;
}

/** Identify speakers, store them, and label unlabelled cues with the dominant speaker. */
export async function identifyVoices(say: (m: string) => void = () => {}): Promise<number> {
  const stored = (() => {
    try {
      return Number(localStorage.getItem('voiceCount')) || null;
    } catch {
      return null;
    }
  })();
  const r = await identifySpeakers(app.project, {
    count: stored,
    nameFor: (i) => `${t('Character')} ${'ABCDEFGHIJ'[i]}`,
    onProgress: (e) =>
      say(
        e.type === 'progress'
          ? e.stage === 'download'
            ? `${t('Downloading model')} ${Math.round(e.pct * 100)}%`
            : `${t('Analysing voices')} ${Math.round(e.pct * 100)}%`
          : t('Analysing voices'),
      ),
  });
  app.store.commit(
    'Identify voices',
    (pr) => {
      pr.speakers = { list: r.speakers, segments: r.segments };
      for (const c of pr.cues) {
        if (c.character) continue;
        const sp = r.speakers.find((x) => x.id === dominantSpeaker(r.segments, c.start, c.end));
        if (sp) c.character = sp.name;
      }
    },
    ['speakers', 'cues', 'tracks'],
  );
  void app.engine.refresh();
  return r.speakers.length;
}

// ---------------------------------------------------------------- the runner
/** Runs the steps in order and keeps their progress (reactive: the checklist reads it; switching tabs keeps it). */
class Runner {
  status = $state<Record<StepId, StepStatus>>({
    separate: { state: 'todo', message: '' },
    subtitles: { state: 'todo', message: '' },
    speakers: { state: 'todo', message: '' },
  });
  running = $state(false);
  projectId: string | null = null;

  reset(): void {
    this.projectId = app.store.current?.id || null;
    for (const s of STEPS) this.status[s.id] = { state: stepDone(s.id) ? 'done' : 'todo', message: '' };
    this.running = false;
  }
  #set(id: StepId, state: StepState, message = '') {
    this.status[id] = { state, message };
  }
  async run(ids: StepId[], language: string): Promise<void> {
    if (this.running) return;
    this.running = true;
    const pid = app.project.id;
    try {
      for (const id of ids) {
        if (app.store.current?.id !== pid) return; // left the project
        if (stepDone(id) && ids.length > 1) {
          this.#set(id, 'done');
          continue;
        }
        this.#set(id, 'running', t('Starting…'));
        const say = (m: string) => this.#set(id, 'running', m);
        try {
          if (id === 'separate') {
            const r = await separateDialogue(say);
            this.#set(id, r === 'ready' ? 'done' : 'skipped', r === 'ready' ? '' : t('Mono clip and no neural separator installed (pnpm setup:separation).'));
          } else if (id === 'subtitles') {
            const n = await makeSubtitles(language, say);
            this.#set(id, n ? 'done' : 'skipped', n ? t('{n} cues', { n }) : t('No speech found.'));
          } else {
            if (app.project.stems.status !== 'ready') {
              this.#set(id, 'skipped', t('Needs the dialogue separated first.'));
              continue;
            }
            const n = await identifyVoices(say);
            this.#set(id, 'done', t('{n} voices found', { n }));
          }
        } catch (e) {
          this.#set(id, 'error', errorMessage(e));
        }
      }
    } finally {
      this.running = false;
    }
  }
}
export const prepare = new Runner();

/** Ask for a prepare run as soon as the studio opens this project (set by the new-project dialog). */
export function requestPrepare(projectId: string, language: string): void {
  try {
    sessionStorage.setItem(`prepare:${projectId}`, language);
  } catch {}
}
export function takePrepareRequest(projectId: string): string | null {
  try {
    const v = sessionStorage.getItem(`prepare:${projectId}`);
    sessionStorage.removeItem(`prepare:${projectId}`);
    return v;
  } catch {
    return null;
  }
}
