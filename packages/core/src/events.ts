/** Minimal typed event emitter shared by the browser engine and UI. */
// biome-ignore lint/suspicious/noExplicitAny: listener argument lists are user-defined per event map
export type Listener = (...args: any[]) => void;

export class Emitter<Events extends Record<string, Listener> = Record<string, Listener>> {
  #handlers = new Map<keyof Events, Set<Listener>>();
  on<K extends keyof Events>(evt: K, fn: Events[K]): () => void {
    let set = this.#handlers.get(evt);
    if (!set) {
      set = new Set();
      this.#handlers.set(evt, set);
    }
    set.add(fn);
    return () => this.off(evt, fn);
  }
  off<K extends keyof Events>(evt: K, fn: Events[K]): void {
    this.#handlers.get(evt)?.delete(fn);
  }
  emit<K extends keyof Events>(evt: K, ...args: Parameters<Events[K]>): void {
    for (const fn of [...(this.#handlers.get(evt) || [])]) {
      try {
        fn(...args);
      } catch (e) {
        console.error(`[${String(evt)}]`, e);
      }
    }
  }
}
