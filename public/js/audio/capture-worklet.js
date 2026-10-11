// Mic capture: meters continuously, and while armed streams raw mono PCM chunks to the main thread.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rec = false; this.chunk = new Float32Array(4096); this.fill = 0;
    this.peak = 0; this.sumSq = 0; this.n = 0; this.clipped = 0;
    this.port.onmessage = (e) => {
      if (e.data.type === 'start') { this.rec = true; this.fill = 0; this.startFrame = currentFrame; this.port.postMessage({ type: 'started', frame: currentFrame }); }
      else if (e.data.type === 'stop') { this.#flush(); this.rec = false; this.port.postMessage({ type: 'stopped', frame: currentFrame }); }
    };
  }
  #flush() {
    if (!this.fill) return;
    const out = this.chunk.slice(0, this.fill); this.fill = 0;
    this.port.postMessage({ type: 'data', chunk: out }, [out.buffer]);
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i], a = Math.abs(v);
      if (a > this.peak) this.peak = a;
      if (a >= 0.999) this.clipped++;
      this.sumSq += v * v;
      if (this.rec) { this.chunk[this.fill++] = v; if (this.fill === this.chunk.length) this.#flush(); }
    }
    this.n += ch.length;
    if (this.n >= 2048) {
      this.port.postMessage({ type: 'level', peak: this.peak, rms: Math.sqrt(this.sumSq / this.n), clipped: this.clipped, frame: currentFrame });
      this.peak = 0; this.sumSq = 0; this.n = 0; this.clipped = 0;
    }
    return true;
  }
}
registerProcessor('capture', Capture);
