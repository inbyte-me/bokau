/// <reference path="./worklet-env.d.ts" />
// Mic capture: meters continuously, and while armed streams raw mono PCM chunks to the main thread.

export type CaptureMessage =
  | { type: 'started'; frame: number }
  | { type: 'stopped'; frame: number }
  | { type: 'data'; chunk: Float32Array }
  | { type: 'level'; peak: number; rms: number; clipped: number; frame: number };

class Capture extends AudioWorkletProcessor {
  rec = false;
  chunk = new Float32Array(4096);
  fill = 0;
  peak = 0;
  sumSq = 0;
  n = 0;
  clipped = 0;
  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ type: 'start' | 'stop' }>) => {
      if (e.data.type === 'start') {
        this.rec = true;
        this.fill = 0;
        this.#post({ type: 'started', frame: currentFrame });
      } else if (e.data.type === 'stop') {
        this.#flush();
        this.rec = false;
        this.#post({ type: 'stopped', frame: currentFrame });
      }
    };
  }
  #post(m: CaptureMessage, transfer: Transferable[] = []) {
    this.port.postMessage(m, transfer);
  }
  #flush() {
    if (!this.fill) return;
    const out = this.chunk.slice(0, this.fill);
    this.fill = 0;
    this.#post({ type: 'data', chunk: out }, [out.buffer]);
  }
  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      const a = Math.abs(v);
      if (a > this.peak) this.peak = a;
      if (a >= 0.999) this.clipped++;
      this.sumSq += v * v;
      if (this.rec) {
        this.chunk[this.fill++] = v;
        if (this.fill === this.chunk.length) this.#flush();
      }
    }
    this.n += ch.length;
    if (this.n >= 2048) {
      this.#post({ type: 'level', peak: this.peak, rms: Math.sqrt(this.sumSq / this.n), clipped: this.clipped, frame: currentFrame });
      this.peak = 0;
      this.sumSq = 0;
      this.n = 0;
      this.clipped = 0;
    }
    return true;
  }
}
registerProcessor('capture', Capture);
