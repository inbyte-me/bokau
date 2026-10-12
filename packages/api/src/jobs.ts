import crypto from 'node:crypto';
import { errorMessage, type Job, type JobKind, type Progress } from '@doblaje/core';

/**
 * In-memory tracker for long work (ingest, stems, export); clients poll /api/jobs/:id.
 * Jobs are deliberately not persisted: they belong to the running ffmpeg/Demucs process and die with it.
 */
export class Jobs {
  #map = new Map<string, Job>();

  get(id: string): Job | undefined {
    return this.#map.get(id);
  }

  /** Start `fn` in the background and return its job immediately. */
  run<R>(kind: JobKind, fn: (progress: Progress) => Promise<R>, meta: { projectId?: string } = {}): Job<R> {
    const job: Job<R> = {
      id: `j${crypto.randomBytes(5).toString('hex')}`,
      kind,
      status: 'running',
      progress: 0,
      message: '',
      result: null,
      error: null,
      startedAt: Date.now(),
      ...meta,
    };
    this.#map.set(job.id, job as Job);
    if (this.#map.size > 200) this.#map.delete(this.#map.keys().next().value as string);
    const progress: Progress = (p, message) => {
      job.progress = p;
      job.message = message;
    };
    Promise.resolve()
      .then(() => fn(progress))
      .then((r) => Object.assign(job, { status: 'done', progress: 1, result: r ?? null }))
      .catch((e: unknown) => {
        console.error(`[job ${kind}]`, errorMessage(e));
        Object.assign(job, { status: 'error', error: errorMessage(e) });
      });
    return job;
  }
}
