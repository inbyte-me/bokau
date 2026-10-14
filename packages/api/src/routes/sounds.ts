import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '@doblaje/core';
import { isSoundId } from '@doblaje/db';
import { importSound } from '@doblaje/media';
import type { AppContext } from '../context.ts';
import { readJson, safeFileName, streamToFile } from '../http.ts';
import { type Router, reply } from '../router.ts';

const SOUND_EXT = /^\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|mp4|mov|mkv)$/;

/** The background-audio library (what waiting phones play during a party round). */
export function soundRoutes(r: Router, ctx: AppContext): void {
  const { cfg, sounds, jobs } = ctx;
  const soundId = (id: string) => {
    if (!isSoundId(id)) throw new AppError(400, 'bad id');
    return id;
  };

  r.get('/api/sounds', () => sounds.list());
  // raw body upload, `x-filename` header → 202 { job } whose result is the new Sound
  r.post('/api/sounds', async ({ req }) => {
    const original = safeFileName(req.headers['x-filename']) || 'sound.mp3';
    const ext = path.extname(original).toLowerCase();
    if (!SOUND_EXT.test(ext)) throw new AppError(415, 'unsupported file type');
    const id = sounds.newId();
    const upload = path.join(sounds.dir, `${id}.upload${ext}`);
    await streamToFile(req, upload, 1024 ** 3);
    const name = path.basename(original, ext).replace(/_/g, ' ');
    const job = jobs.run('sound', async (progress) => {
      try {
        const duration = await importSound(cfg.media, upload, sounds.file(id), progress);
        return sounds.add(id, { name, duration });
      } finally {
        fs.rmSync(upload, { force: true });
      }
    });
    return reply(202, { job: job.id });
  });
  r.put<'id'>('/api/sounds/:id', async ({ req, params }) => {
    const b = await readJson<{ name?: string }>(req);
    const name = String(b.name ?? '').trim();
    if (!name) throw new AppError(400, 'name is required');
    return sounds.rename(soundId(params.id), name);
  });
  r.delete<'id'>('/api/sounds/:id', ({ params }) => {
    sounds.remove(soundId(params.id));
    return { ok: true };
  });
}
