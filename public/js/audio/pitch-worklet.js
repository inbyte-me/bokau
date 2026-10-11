import { PitchShifterCore } from './pitch-core.js';

class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'semitones', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'k-rate' },
      { name: 'formant', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.cores = []; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp.length) return true;
    const ratio = 2 ** (params.semitones[0] / 12), formant = params.formant[0] >= 0.5;
    for (let c = 0; c < out.length; c++) {
      const core = this.cores[c] || (this.cores[c] = new PitchShifterCore(sampleRate));
      core.process(inp[Math.min(c, inp.length - 1)], out[c], ratio, formant);
    }
    return true;
  }
}
registerProcessor('pitch-shifter', PitchShifter);
