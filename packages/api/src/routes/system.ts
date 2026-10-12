import { GENRES, isTask, MODELS, type RewriteCueInput, type RewriteParams, rewrite } from '@doblaje/ai';
import { AppError } from '@doblaje/core';
import { neuralAvailable } from '@doblaje/media';
import type { AppContext } from '../context.ts';
import { readJson } from '../http.ts';
import type { Router } from '../router.ts';

export function systemRoutes(r: Router, ctx: AppContext): void {
  r.get('/api/health', () => ({ ok: true, ffmpeg: ctx.ffmpegVersion }));
  r.get('/api/system', () => ({
    neuralSeparation: neuralAvailable(ctx.cfg.media),
    ffmpeg: ctx.ffmpegVersion,
    ai: ctx.ai.status(),
    node: process.version,
    localOnly: ctx.localOnly,
    electron: process.versions.electron || null,
  }));
  r.get<'id'>('/api/jobs/:id', ({ params }) => {
    const j = ctx.jobs.get(params.id);
    if (!j) throw new AppError(404, 'job not found');
    return j;
  });
}

export function aiRoutes(r: Router, ctx: AppContext): void {
  r.get('/api/ai/status', () => ({ ...ctx.ai.status(), models: MODELS, genres: Object.keys(GENRES) }));
  r.post('/api/ai/rewrite', async ({ req }) => {
    const b = await readJson<{ task?: string; params?: RewriteParams; cues?: RewriteCueInput[] }>(req, 2 * 1024 * 1024);
    if (!isTask(b.task)) throw new AppError(400, 'unknown task');
    const result = await rewrite(ctx.ai, b.task, Array.isArray(b.cues) ? b.cues : [], b.params || {});
    return { ...result, spend: ctx.ai.status() };
  });
}
