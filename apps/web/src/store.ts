import { type EditableProject, Emitter, migrate, type Project } from '@doblaje/core';
import { debounce } from '@doblaje/ui';
import { api } from './api.ts';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
/** What changed, so views can redraw only what they show ('all' = anything). */
export type ChangeKinds = Set<string>;
type Snapshot = Omit<Project, 'media' | 'stems'>;
type StoreEvents = {
  open: (p: Project) => void;
  change: (kinds: ChangeKinds) => void;
  'save-state': (s: SaveState) => void;
};

/**
 * Single source of truth for the open project.
 * commit(label, fn) mutates the project, records an undo snapshot, emits 'change' and schedules autosave.
 * Only the editable part is snapshotted/saved; `media` and `stems` are server-owned.
 */
export class Store extends Emitter<StoreEvents> {
  #project: Project | null = null;
  undoStack: { label: string; before: Snapshot; t: number }[] = [];
  redoStack: { label: string; before: Snapshot }[] = [];
  saveState: SaveState = 'saved';
  /** when the server last confirmed a save (ms since epoch) */
  lastSavedAt: number | null = null;
  #inFlight: Promise<boolean> | null = null;
  #save = debounce(() => void this.flush(), 700);

  /** The open project. Throws when none is open; use `current` to test. */
  get project(): Project {
    if (!this.#project) throw new Error('no project open');
    return this.#project;
  }
  get current(): Project | null {
    return this.#project;
  }

  async open(id: string): Promise<Project> {
    const p = migrate(await api.project(id));
    this.#project = p;
    this.undoStack = [];
    this.redoStack = [];
    this.saveState = 'saved';
    this.lastSavedAt = Date.parse(p.updatedAt) || null;
    this.emit('open', p);
    this.emit('change', new Set(['all']));
    return p;
  }
  close(): void {
    this.#project = null;
    this.undoStack = [];
    this.redoStack = [];
  }
  /** replace server-owned parts (after ingest/stems) without touching undo */
  refreshServerParts(p: Pick<Project, 'media' | 'stems'>): void {
    Object.assign(this.project, { media: p.media, stems: p.stems });
    this.emit('change', new Set(['media']));
  }

  snapshot(): Snapshot {
    const { media: _m, stems: _s, ...rest } = this.project;
    return structuredClone(rest);
  }
  commit(label: string, fn: (p: Project) => void, kinds: string[] = ['all'], { merge = false } = {}): void {
    const before = this.snapshot();
    fn(this.project);
    const last = this.undoStack.at(-1);
    if (merge && last?.label === label && Date.now() - last.t < 1200) last.t = Date.now();
    else {
      this.undoStack.push({ label, before, t: Date.now() });
      if (this.undoStack.length > 150) this.undoStack.shift();
    }
    this.redoStack = [];
    this.#dirty(kinds);
  }
  /** change without an undo entry (e.g. live slider drags that commit on release) */
  silent(fn: (p: Project) => void, kinds: string[] = ['all']): void {
    fn(this.project);
    this.#dirty(kinds);
  }
  #dirty(kinds: string[]) {
    this.saveState = 'dirty';
    this.emit('change', new Set(kinds));
    this.emit('save-state', 'dirty');
    this.#save();
  }

  undo(): string | false {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.redoStack.push({ label: e.label, before: this.snapshot() });
    this.#restore(e.before);
    return e.label;
  }
  redo(): string | false {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.undoStack.push({ label: e.label, before: this.snapshot(), t: 0 });
    this.#restore(e.before);
    return e.label;
  }
  #restore(snap: Snapshot) {
    Object.assign(this.project, structuredClone(snap));
    this.#dirty(['all']);
  }

  /** Autosave and route changes: save only when there is something to save. */
  async flush(): Promise<void> {
    if (!this.#project || this.saveState === 'saved') return;
    await this.save();
  }

  /**
   * Save now (File → Save, the save button, ⌘/Ctrl+S). Always writes, so a manual save confirms even when nothing
   * changed; never overlaps another save. Edits made while saving keep the state 'dirty' and are saved next.
   */
  async save(): Promise<boolean> {
    const p = this.#project;
    if (!p) return false;
    this.#save.cancel();
    if (this.#inFlight) await this.#inFlight;
    const run = (async () => {
      this.saveState = 'saving';
      this.emit('save-state', 'saving');
      try {
        await api.savedProject(p.id, this.snapshot() as Partial<EditableProject>);
        if (this.saveState === 'saving') this.saveState = 'saved';
        this.lastSavedAt = Date.now();
        return true;
      } catch (e) {
        console.error('save failed', e);
        this.saveState = 'error';
        return false;
      } finally {
        this.emit('save-state', this.saveState);
      }
    })();
    this.#inFlight = run;
    try {
      return await run;
    } finally {
      if (this.#inFlight === run) this.#inFlight = null;
    }
  }
}
export const store = new Store();
