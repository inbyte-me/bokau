// Streaming phase-vocoder pitch shifter (bin-shifting, after S. Bernsee's smbPitchShift) with optional
// cepstral spectral-envelope correction so formants stay put ("cartoon squirrel" without chipmunk vowels).
// Pure JS, no Web Audio dependency: runs in an AudioWorklet and in Node tests.

export class FFT {
  readonly n: number;
  readonly cos: Float64Array;
  readonly sin: Float64Array;
  readonly rev: Uint32Array;
  constructor(n: number) {
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }
  /** in-place complex FFT; inverse=true gives the UNnormalized inverse */
  transform(re: Float64Array, im: Float64Array, inverse = false): void {
    const n = this.n,
      rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    const sgn = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1,
        step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = this.cos[k],
            wi = sgn * this.sin[k];
          const a = i + j,
            b = a + half;
          const tr = re[b] * wr - im[b] * wi,
            ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

const TWO_PI = 2 * Math.PI;

/** One channel of pitch shifting. process(in, out, ratio, preserveFormants) handles any block size. */
export class PitchShifterCore {
  readonly sr: number;
  readonly N: number;
  readonly OS: number;
  readonly step: number;
  /** output delay in samples */
  readonly latency: number;
  readonly fft: FFT;
  readonly win: Float64Array;
  readonly inFifo: Float64Array;
  readonly outFifo: Float64Array;
  readonly accum: Float64Array;
  readonly re: Float64Array;
  readonly im: Float64Array;
  readonly lastPhase: Float64Array;
  readonly sumPhase: Float64Array;
  readonly anaMagn: Float64Array;
  readonly anaFreq: Float64Array;
  readonly synMagn: Float64Array;
  readonly synFreq: Float64Array;
  readonly env: Float64Array;
  readonly cre: Float64Array;
  readonly cim: Float64Array;
  readonly lifter: number;
  rover: number;

  constructor(sampleRate = 48000, { fftSize = 2048, overlap = 4 } = {}) {
    this.sr = sampleRate;
    this.N = fftSize;
    this.OS = overlap;
    const N = fftSize,
      H = N / 2;
    this.step = N / overlap;
    this.latency = N - this.step;
    this.fft = new FFT(N);
    this.win = new Float64Array(N);
    for (let i = 0; i < N; i++) this.win[i] = -0.5 * Math.cos((TWO_PI * i) / N) + 0.5;
    this.inFifo = new Float64Array(N);
    this.outFifo = new Float64Array(N);
    this.accum = new Float64Array(2 * N);
    this.re = new Float64Array(N);
    this.im = new Float64Array(N);
    this.lastPhase = new Float64Array(H + 1);
    this.sumPhase = new Float64Array(H + 1);
    this.anaMagn = new Float64Array(H + 1);
    this.anaFreq = new Float64Array(H + 1);
    this.synMagn = new Float64Array(H + 1);
    this.synFreq = new Float64Array(H + 1);
    this.env = new Float64Array(H + 1);
    this.cre = new Float64Array(N);
    this.cim = new Float64Array(N);
    this.lifter = Math.max(8, Math.round(sampleRate * 0.0016)); // ~1.6 ms quefrency => smooth formant envelope
    this.rover = this.latency;
  }

  process(input: ArrayLike<number>, output: Float32Array | number[], ratio = 1, preserveFormants = false): void {
    const { N, OS, step, latency, win, re, im } = this;
    const H = N / 2,
      freqPerBin = this.sr / N,
      expct = (TWO_PI * step) / N;
    for (let i = 0; i < input.length; i++) {
      this.inFifo[this.rover] = input[i];
      output[i] = this.outFifo[this.rover - latency];
      if (++this.rover < N) continue;
      this.rover = latency;

      for (let k = 0; k < N; k++) {
        re[k] = this.inFifo[k] * win[k];
        im[k] = 0;
      }
      this.fft.transform(re, im);

      // analysis: true frequency of each bin from the phase advance
      for (let k = 0; k <= H; k++) {
        const magn = 2 * Math.hypot(re[k], im[k]);
        const phase = Math.atan2(im[k], re[k]);
        let tmp = phase - this.lastPhase[k];
        this.lastPhase[k] = phase;
        tmp -= k * expct;
        let qpd = Math.trunc(tmp / Math.PI);
        qpd += qpd >= 0 ? qpd & 1 : -(qpd & 1);
        tmp -= Math.PI * qpd;
        tmp = (OS * tmp) / TWO_PI;
        this.anaMagn[k] = magn;
        this.anaFreq[k] = k * freqPerBin + tmp * freqPerBin;
      }

      const useEnv = preserveFormants && ratio !== 1;
      if (useEnv) this.#envelope();

      // pitch shift: move each bin (and its true frequency) to bin*ratio
      this.synMagn.fill(0);
      this.synFreq.fill(0);
      for (let k = 0; k <= H; k++) {
        const idx = Math.round(k * ratio);
        if (idx > H) break;
        const m = useEnv ? this.anaMagn[k] / this.env[k] : this.anaMagn[k];
        this.synMagn[idx] += m;
        this.synFreq[idx] = this.anaFreq[k] * ratio;
      }
      if (useEnv) for (let k = 0; k <= H; k++) this.synMagn[k] *= this.env[k];
      // shifting down merges bins (magnitudes add up): never let the output carry more energy than the input had
      let inE = 0,
        outE = 0;
      for (let k = 0; k <= H; k++) {
        inE += this.anaMagn[k] * this.anaMagn[k];
        outE += this.synMagn[k] * this.synMagn[k];
      }
      if (outE > inE && outE > 0) {
        const g = Math.sqrt(inE / outE);
        for (let k = 0; k <= H; k++) this.synMagn[k] *= g;
      }

      // synthesis
      for (let k = 0; k <= H; k++) {
        let tmp = this.synFreq[k] - k * freqPerBin;
        tmp /= freqPerBin;
        tmp = (TWO_PI * tmp) / OS;
        tmp += k * expct;
        this.sumPhase[k] += tmp;
        const p = this.sumPhase[k],
          m = this.synMagn[k];
        re[k] = m * Math.cos(p);
        im[k] = m * Math.sin(p);
      }
      for (let k = H + 1; k < N; k++) {
        re[k] = 0;
        im[k] = 0;
      }
      this.fft.transform(re, im, true);
      const scale = 2 / (H * OS * ((3 * OS) / 8)); // Hann^2 overlap-add gain = 3*OS/8
      for (let k = 0; k < N; k++) this.accum[k] += win[k] * re[k] * scale;
      for (let k = 0; k < step; k++) this.outFifo[k] = this.accum[k];
      this.accum.copyWithin(0, step, step + N);
      this.accum.fill(0, N);
      this.inFifo.copyWithin(0, step, step + latency);
    }
  }

  /** smoothed log-magnitude envelope via cepstral liftering */
  #envelope(): void {
    const { N, cre, cim, lifter } = this;
    const H = N / 2;
    for (let k = 0; k <= H; k++) {
      cre[k] = Math.log(Math.max(this.anaMagn[k], 1e-9));
      cim[k] = 0;
    }
    for (let k = H + 1; k < N; k++) {
      cre[k] = cre[N - k];
      cim[k] = 0;
    }
    this.fft.transform(cre, cim);
    for (let q = lifter + 1; q < N - lifter; q++) {
      cre[q] = 0;
      cim[q] = 0;
    }
    this.fft.transform(cre, cim, true);
    for (let k = 0; k <= H; k++) this.env[k] = Math.max(Math.exp(cre[k] / N), 1e-9);
  }
}
