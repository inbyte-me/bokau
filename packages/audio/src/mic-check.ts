import { gainToDb } from '@doblaje/core';

// Pure analysis of a guided mic check (kept apart from Mic so it can be unit-tested in Node).

export interface LevelSample {
  rms: number[];
  peak: number;
  clips: number;
}
export type MicAdvice = 'silent' | 'clipping' | 'too-quiet' | 'quiet' | 'noisy' | 'low-snr' | 'good';
export interface MicCheck {
  noiseDb: number;
  speechDb: number;
  peakDb: number;
  snr: number;
  advice: MicAdvice[];
  suggestedGainDb: number;
  clips: number;
}

export function analyzeCheck(quiet: LevelSample, loud: LevelSample): MicCheck {
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const noiseDb = gainToDb(avg(quiet.rms));
  const sorted = [...loud.rms].sort((a, b) => a - b);
  const speechRms = sorted.length ? sorted[Math.floor(sorted.length * 0.85)] : 0;
  const speechDb = gainToDb(speechRms);
  const peakDb = gainToDb(loud.peak);
  const snr = speechDb - noiseDb;
  const advice: MicAdvice[] = [];
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
