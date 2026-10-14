/** A sliding-window limit per key (an address): `allow` says whether one more may pass, and counts it when it does. */
export class RateLimit {
  readonly #hits = new Map<string, number[]>();
  readonly #max: number;
  readonly #windowMs: number;

  constructor(max: number, windowMs: number) {
    this.#max = max;
    this.#windowMs = windowMs;
  }

  allow(key: string, now = Date.now()): boolean {
    const recent = (this.#hits.get(key) ?? []).filter((t) => now - t < this.#windowMs);
    if (recent.length >= this.#max) {
      this.#hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(key, recent);
    if (this.#hits.size > 5000) for (const [k, v] of this.#hits) if (!v.some((t) => now - t < this.#windowMs)) this.#hits.delete(k);
    return true;
  }
}
