// Read a framework-free source (the party client, the store, the engine…) reactively in Svelte, without copying its
// state in an $effect: reading `.current` inside a template or $derived subscribes while it is in use.
import { createSubscriber } from 'svelte/reactivity';

/** Anything with a current value and a subscribe() that calls back on change (the Svelte store contract fits). */
export interface Source<T> {
  readonly state: T;
  subscribe(run: (value: T) => void): () => void;
}

export class Live<T> {
  readonly #source: Source<T>;
  readonly #subscribe: () => void;

  constructor(source: Source<T>) {
    this.#source = source;
    this.#subscribe = createSubscriber((update) => {
      let first = true; // store-contract subscribe() calls back immediately; that value is read through `current`
      return this.#source.subscribe(() => {
        if (first) first = false;
        else update();
      });
    });
  }

  get current(): T {
    this.#subscribe();
    return this.#source.state;
  }
}
