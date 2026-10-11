import { Emitter, dbToGain, gainToDb } from '../util.js';

/**
 * Microphone input tuned for cheap mics + USB interfaces:
 *  - raw capture (no echo-cancel / noise-suppression / AGC unless asked) for cleaner dry takes
 *  - pick the interface channel (many 2-in interfaces only have the mic on input 1)
 *  - software trim gain, live peak/RMS meter, clip detection, optional headphone monitoring
 */
export class Mic extends Emitter {
  constructor(engine) { super(); this.engine = engine; this.stream = null; this.chunks = []; this.capturing = false; this.last = { peak: 0, rms: 0, clipped: 0 }; this.settings = { deviceId: 'default', channel: 'auto', gainDb: 0, aec: false, monitor: false, monitorPan: 0 }; }

  static async devices() {
    let list = [];
    try { list = await navigator.mediaDevices.enumerateDevices(); } catch {}
    return { inputs: list.filter((d) => d.kind === 'audioinput'), outputs: list.filter((d) => d.kind === 'audiooutput'), labelled: list.some((d) => d.label) };
  }

  async open(settings = {}) {
    Object.assign(this.settings, settings);
    this.close();
    const ctx = this.engine.ctx; const s = this.settings;
    const constraints = { audio: { deviceId: s.deviceId && s.deviceId !== 'default' ? { exact: s.deviceId } : undefined, channelCount: { ideal: 2 }, echoCancellation: s.aec, noiseSuppression: false, autoGainControl: false, sampleRate: { ideal: 48000 }, latency: { ideal: 0 } } };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    const track = this.stream.getAudioTracks()[0];
    this.info = { label: track.label, ...track.getSettings() };
    if (!this.workletLoaded) { await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url)); this.workletLoaded = true; }
    this.src = ctx.createMediaStreamSource(this.stream);
    this.split = ctx.createChannelSplitter(2); this.mono = ctx.createGain(); this.trim = ctx.createGain();
    this.node = new AudioWorkletNode(ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    this.sink = ctx.createGain(); this.sink.gain.value = 0; // keeps the worklet "pulled" without making sound
    this.monGain = ctx.createGain(); this.monGain.gain.value = 0; this.monPan = ctx.createStereoPanner();
    this.anL = ctx.createAnalyser(); this.anR = ctx.createAnalyser(); this.anL.fftSize = this.anR.fftSize = 2048;
    this.src.connect(this.split); this.split.connect(this.anL, 0); if ((this.info.channelCount || 1) > 1) this.split.connect(this.anR, 1);
    this.mono.connect(this.trim); this.trim.connect(this.node); this.node.connect(this.sink); this.sink.connect(ctx.destination);
    this.trim.connect(this.monGain); this.monGain.connect(this.monPan); this.monPan.connect(ctx.destination);
    this.#route(); this.setGainDb(s.gainDb); this.setMonitor(s.monitor, s.monitorPan); this.autoChannel = null; this.#watchChannels();
    this.node.port.onmessage = (e) => this.#onMsg(e.data);
    return this.info;
  }
  /** processed mono signal (after channel pick + trim) as a MediaStream, for MediaRecorder */
  get recordStream() {
    if (!this._recDest) { this._recDest = this.engine.ctx.createMediaStreamDestination(); this._recDest.channelCount = 1; this.trim.connect(this._recDest); }
    return this._recDest.stream;
  }
  get channels() { return this.info?.channelCount || 1; }
  #route() {
    try { this.split.disconnect(this.mono); } catch {} // keep the per-channel analysers attached
    const ch = this.settings.channel === 'auto' ? (this.autoChannel || 'mix') : this.settings.channel;
    if (this.channels < 2 || ch === 'mix') { this.mono.gain.value = this.channels < 2 ? 1 : 0.5; this.split.connect(this.mono, 0); if (this.channels >= 2) this.split.connect(this.mono, 1); }
    else { this.mono.gain.value = 1; this.split.connect(this.mono, ch === 'right' ? 1 : 0); }
  }
  /**
   * "Auto" on a 2-input interface: budget interfaces usually carry the mic on input 1 only. Mixing a dead input in
   * costs 6 dB and adds its noise, so once one side clearly carries the signal we route just that side.
   */
  #watchChannels() {
    clearInterval(this._chTimer); if (this.channels < 2) return;
    const buf = new Float32Array(2048); const rms = (an) => { an.getFloatTimeDomainData(buf); let sum = 0; for (const v of buf) sum += v * v; return Math.sqrt(sum / buf.length); };
    let L = 0, R = 0, n = 0;
    this._chTimer = setInterval(() => {
      if (!this.stream || this.settings.channel !== 'auto') { L = R = n = 0; return; }
      const l = rms(this.anL), r = rms(this.anR); L = Math.max(L * 0.9, l); R = Math.max(R * 0.9, r); n++;
      if (n < 8) return;
      const ratioDb = 20 * Math.log10((L + 1e-9) / (R + 1e-9)); let pick = this.autoChannel;
      if (Math.max(L, R) > 0.003) pick = ratioDb > 18 ? 'left' : ratioDb < -18 ? 'right' : 'mix';
      if (pick !== this.autoChannel) { this.autoChannel = pick; this.#route(); this.emit('auto-channel', pick); }
    }, 250);
  }
  setChannel(ch) { this.settings.channel = ch; if (this.split) this.#route(); }
  setGainDb(db) { this.settings.gainDb = db; if (this.trim) this.trim.gain.setTargetAtTime(dbToGain(db), this.engine.ctx.currentTime, 0.02); }
  setMonitor(on, pan = 0) { this.settings.monitor = on; this.settings.monitorPan = pan; if (this.monGain) { this.monGain.gain.setTargetAtTime(on ? 1 : 0, this.engine.ctx.currentTime, 0.02); this.monPan.pan.value = pan; } }
  close() {
    clearInterval(this._chTimer);
    this.stream?.getTracks().forEach((t) => t.stop()); try { this._recDest?.disconnect(); } catch {} this._recDest = null;
    for (const n of [this.src, this.split, this.mono, this.trim, this.node, this.sink, this.monGain, this.monPan]) { try { n?.disconnect(); } catch {} }
    this.stream = null;
  }
  get isOpen() { return !!this.stream?.active; }

  #onMsg(m) {
    if (m.type === 'level') {
      this.last = { peak: m.peak, rms: m.rms, clipped: m.clipped, peakDb: gainToDb(m.peak), rmsDb: gainToDb(m.rms) };
      this.emit('level', this.last);
    } else if (m.type === 'data') { if (this.capturing) this.chunks.push(m.chunk); }
    else if (m.type === 'started') this._startResolve?.(m.frame);
    else if (m.type === 'stopped') this._stopResolve?.(m.frame);
  }
  /** begin capturing; resolves with the exact ctx frame of the first sample */
  startCapture() {
    this.chunks = []; this.capturing = true;
    return new Promise((res) => { this._startResolve = res; this.node.port.postMessage({ type: 'start' }); });
  }
  async stopCapture() {
    await new Promise((res) => { this._stopResolve = res; this.node.port.postMessage({ type: 'stop' }); });
    await new Promise((r) => setTimeout(r, 15)); // let the final chunk message land
    this.capturing = false;
    const n = this.chunks.reduce((a, c) => a + c.length, 0); const out = new Float32Array(n); let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; } this.chunks = [];
    return out;
  }

  /**
   * Guided mic check: 2 s of silence then 3 s of speech -> advice for a low-budget mic chain.
   */
  async check({ silenceSec = 2, speakSec = 3, onPhase } = {}) {
    const collect = (sec) => new Promise((res) => { const rms = []; let peak = 0, clips = 0; const off = this.on('level', (l) => { rms.push(l.rms); peak = Math.max(peak, l.peak); clips += l.clipped; }); setTimeout(() => { off(); res({ rms, peak, clips }); }, sec * 1000); });
    onPhase?.('silence'); const quiet = await collect(silenceSec);
    onPhase?.('speak'); const loud = await collect(speakSec);
    return analyzeCheck(quiet, loud);
  }
}

export function analyzeCheck(quiet, loud) {
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const noiseDb = gainToDb(avg(quiet.rms));
  const sorted = [...loud.rms].sort((a, b) => a - b); const speechRms = sorted.length ? sorted[Math.floor(sorted.length * 0.85)] : 0;
  const speechDb = gainToDb(speechRms), peakDb = gainToDb(loud.peak);
  const snr = speechDb - noiseDb;
  const advice = [];
  if (loud.peak < 0.01) advice.push('silent');
  else {
    if (loud.clips > 0 || peakDb > -1.5) advice.push('clipping');
    else if (peakDb < -24) advice.push('too-quiet');
    else if (peakDb < -14) advice.push('quiet');
    if (noiseDb > -45) advice.push('noisy');
    if (snr < 20 && !advice.includes('noisy')) advice.push('low-snr');
  }
  if (!advice.length) advice.push('good');
  // suggest a trim that brings speech peaks to about -6 dBFS
  const suggestedGainDb = loud.peak > 0.01 ? Math.max(-12, Math.min(30, -6 - peakDb)) : 0;
  return { noiseDb, speechDb, peakDb, snr, advice, suggestedGainDb, clips: loud.clips };
}
