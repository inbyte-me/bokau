import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type MediaConfig, runFfmpeg } from '@doblaje/media';

/** Whisper names languages in full. */
const LANGUAGE: Record<string, string> = { en: 'english', es: 'spanish', fr: 'french', pt: 'portuguese', de: 'german', it: 'italian' };

/**
 * The server listens to a take: speech-to-text with the same model the studio uses for subtitles, run here (onnxruntime
 * in Node) instead of in a browser, so a room needs no TV for it. One take at a time; the model loads on first use and
 * is cached under `modelsDir`. Any failure is "no transcript": the game does not depend on it.
 */
export function createTranscriber(media: MediaConfig, modelsDir: string, model = 'Xenova/whisper-base') {
  let pipe: Promise<(audio: Float32Array, o: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>> | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const load = () => {
    pipe ??= import('@huggingface/transformers').then(async ({ env, pipeline }) => {
      env.cacheDir = path.join(modelsDir, 'node');
      return (await pipeline('automatic-speech-recognition', model)) as never;
    });
    return pipe;
  };

  /** 16 kHz mono floats, as Whisper wants them */
  async function samples(file: string): Promise<Float32Array> {
    const raw = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'doblaje-stt-')), 'take.f32');
    try {
      await runFfmpeg(media, ['-i', file, '-ar', '16000', '-ac', '1', '-f', 'f32le', raw]);
      const b = fs.readFileSync(raw);
      return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4)).slice();
    } finally {
      fs.rmSync(path.dirname(raw), { recursive: true, force: true });
    }
  }

  return (file: string, language: string): Promise<string | null> => {
    const run = async () => {
      try {
        const transcribe = await load();
        const out = await transcribe(await samples(file), { language: LANGUAGE[language] ?? 'english', task: 'transcribe' });
        const text = (Array.isArray(out) ? out.map((x) => x.text).join(' ') : out.text).trim();
        return text || null;
      } catch (e) {
        console.warn('[party] could not transcribe a take', e instanceof Error ? e.message : e);
        return null;
      }
    };
    const next = chain.then(run, run);
    chain = next;
    return next;
  };
}
