import { Engine, Mic, RecordSession } from '@doblaje/audio';
import { Emitter, type TimeRange, type Track } from '@doblaje/core';
import type { SystemInfo } from './api.ts';
import { store } from './store.svelte.ts';

export interface Selection {
  trackId: string | null;
  cueId: string | null;
  clipId: string | null;
  segIdx: number | null;
  /** punch / loop region */
  region: TimeRange | null;
}
// biome-ignore lint/suspicious/noExplicitAny: app-wide events carry feature-specific payloads
type AppEvents = Record<string, (...args: any[]) => void>;

/** Shared singleton wiring the pieces together; feature modules import `app`. */
class App extends Emitter<AppEvents> {
  readonly store = store;
  readonly engine = new Engine();
  readonly mic = new Mic(this.engine);
  readonly session = new RecordSession({ engine: this.engine, mic: this.mic, store });
  /** what is selected in the studio (reactive: Svelte views read it directly; h() views listen to 'selection') */
  sel = $state<Selection>({ trackId: null, cueId: null, clipId: null, segIdx: null, region: null });
  /** timeline viewport: left edge seconds, pixels per second (changes every frame while scrolling: not reactive) */
  view = { t0: 0, pps: 60 };
  tv = $state(false);
  system: SystemInfo | null = null;

  select(patch: Partial<Selection>): void {
    Object.assign(this.sel, patch);
    this.emit('selection', this.sel);
  }
  get project() {
    return this.store.project;
  }
  get track(): Track {
    const p = this.project;
    return p.tracks.find((t) => t.id === this.sel.trackId) || p.tracks[0];
  }
}
export const app = new App();
export type AppInstance = typeof app;

declare global {
  interface Window {
    /** handy for debugging and used by the e2e tests */
    __app: AppInstance;
  }
}
window.__app = app;
