import { Emitter, debounce } from './util.js';
import { api } from './api.js';
import { migrate } from '/shared/project.js';

/**
 * Single source of truth for the open project.
 * commit(label, fn) mutates a draft, records an undo snapshot, emits 'change' and schedules autosave.
 * Only the editable part is snapshotted/saved; `media` and `stems` are server-owned.
 */
class Store extends Emitter {
  project = null;
  undoStack = []; redoStack = [];
  saveState = 'saved'; // saved | dirty | saving | error
  #save = debounce(() => this.flush(), 700);

  async open(id) {
    this.project = migrate(await api.project(id));
    this.undoStack = []; this.redoStack = []; this.saveState = 'saved';
    this.emit('open', this.project); this.emit('change', new Set(['all']));
    return this.project;
  }
  close() { this.project = null; this.undoStack = []; this.redoStack = []; }
  /** replace server-owned parts (after ingest/stems) without touching undo */
  refreshServerParts(p) { Object.assign(this.project, { media: p.media, stems: p.stems }); this.emit('change', new Set(['media'])); }

  snapshot() { const { media, stems, ...rest } = this.project; return structuredClone(rest); }
  commit(label, fn, kinds = ['all'], { merge = false } = {}) {
    const before = this.snapshot();
    fn(this.project);
    const last = this.undoStack.at(-1);
    if (merge && last?.label === label && Date.now() - last.t < 1200) last.t = Date.now();
    else { this.undoStack.push({ label, before, t: Date.now() }); if (this.undoStack.length > 150) this.undoStack.shift(); }
    this.redoStack = [];
    this.#dirty(kinds);
  }
  /** change without undo entry (e.g. live slider drags that commit on release) */
  silent(fn, kinds = ['all']) { fn(this.project); this.#dirty(kinds); }
  #dirty(kinds) { this.saveState = 'dirty'; this.emit('change', new Set(kinds)); this.emit('save-state', 'dirty'); this.#save(); }

  undo() { const e = this.undoStack.pop(); if (!e) return false; this.redoStack.push({ label: e.label, before: this.snapshot() }); this.#restore(e.before); return e.label; }
  redo() { const e = this.redoStack.pop(); if (!e) return false; this.undoStack.push({ label: e.label, before: this.snapshot(), t: 0 }); this.#restore(e.before); return e.label; }
  #restore(snap) { Object.assign(this.project, structuredClone(snap)); this.#dirty(['all']); }

  async flush() {
    if (!this.project || this.saveState === 'saved') return;
    this.saveState = 'saving'; this.emit('save-state', 'saving');
    try { await api.savedProject(this.project.id, this.snapshot()); this.saveState = this.saveState === 'saving' ? 'saved' : this.saveState; }
    catch (e) { console.error('save failed', e); this.saveState = 'error'; }
    this.emit('save-state', this.saveState);
  }
}
export const store = new Store();
