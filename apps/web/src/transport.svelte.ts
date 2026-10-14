// The audio engine and the recording session as Svelte sees them: playhead time, playing, recording state and the
// count-in number. The engine stays a plain class (it also runs on phones and in offline renders); this only listens.
import type { SessionState } from '@doblaje/audio';
import { createSubscriber } from 'svelte/reactivity';
import { app } from './app.svelte.ts';

class Transport {
  #engine = createSubscriber((update) => {
    const offs = [app.engine.on('time', update), app.engine.on('play', update), app.engine.on('pause', update), app.engine.on('ended', update)];
    return () => {
      for (const off of offs) off();
    };
  });
  #session = createSubscriber((update) => app.session.on('state', update));
  /** the count-in number while counting (3, 2, 1, 0 = GO), null otherwise */
  count = $state<number | null>(null);

  constructor() {
    app.session.on('countdown', (n: number) => {
      this.count = n;
    });
    app.session.on('state', (s: SessionState) => {
      if (s === 'idle') this.count = null;
      else if (s === 'recording') setTimeout(() => (this.count = null), 600); // let GO show for a moment
    });
  }

  /** playhead, seconds (updates every frame while playing) */
  get time(): number {
    this.#engine();
    return app.engine.time;
  }
  get playing(): boolean {
    this.#engine();
    return app.engine.playing;
  }
  get recording(): SessionState {
    this.#session();
    return app.session.state;
  }
}
export const transport = new Transport();
