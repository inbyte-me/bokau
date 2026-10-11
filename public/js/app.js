import { Emitter } from './util.js';
import { store } from './store.js';
import { engine } from './audio/engine.js';
import { Mic } from './audio/mic.js';
import { RecordSession } from './audio/session.js';

/** Shared singleton wiring the pieces together; UI modules import `app`. */
class App extends Emitter {
  store = store; engine = engine;
  mic = new Mic(engine);
  session = new RecordSession({ engine, mic: this.mic, store });
  sel = { trackId: null, cueId: null, clipId: null, region: null /* {start,end} punch/loop */ };
  view = { t0: 0, pps: 60 }; // timeline viewport: left edge seconds, pixels per second
  tv = false;
  system = null;
  select(patch) { Object.assign(this.sel, patch); this.emit('selection', this.sel); }
  get project() { return this.store.project; }
  get track() { return this.project?.tracks.find((t) => t.id === this.sel.trackId) || this.project?.tracks[0]; }
}
export const app = new App();
window.__app = app; // handy for debugging and e2e tests
