/// <reference path="./worklet-env.d.ts" />
import { PitchShifterCore } from './pitch-core.ts';

class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'semitones', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'k-rate' },
      { name: 'formant', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  cores: PitchShifterCore[] = [];
  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>): boolean {
    const inp = inputs[0];
    const out = outputs[0];
    if (!inp.length) return true;
    const ratio = 2 ** (params.semitones[0] / 12);
    const formant = params.formant[0] >= 0.5;
    for (let c = 0; c < out.length; c++) {
      if (!this.cores[c]) this.cores[c] = new PitchShifterCore(sampleRate);
      this.cores[c].process(inp[Math.min(c, inp.length - 1)], out[c], ratio, formant);
    }
    return true;
  }
}
registerProcessor('pitch-shifter', PitchShifter);
