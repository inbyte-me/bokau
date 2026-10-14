import crypto from 'node:crypto';
import { AppError, errorMessage, type Job, type JobKind, type Progress } from '@doblaje/core';

/** How many heavy jobs (ffmpeg, separation) the whole server runs at once, shared by every person's queue. */
export class Gate {
  running = 0;
  readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
}

/**
 * In-memory tracker for long work (ingest, stems, export); clients poll /api/jobs/:id.
 * Jobs are deliberately not persisted: they belong to the running ffmpeg/Demucs process and die with it.
 */
export class Jobs {
  #map = new Map<string, Job>();
  readonly #perPerson: number;
  readonly #gate: Gate | null;

  /** `perPerson`: jobs one person may have running at once; `gate`: the server-wide limit (a laptop sets neither). */
  constructor({ perPerson = Number.POSITIVE_INFINITY, gate = null }: { perPerson?: number; gate?: Gate | null } = {}) {
    this.#perPerson = perPerson;
    this.#gate = gate;
  }

  get(id: string): Job | undefined {
    return this.#map.get(id);
  }

  /** Start `fn` in the background and return its job immediately. */
  run<R>(kind: JobKind, fn: (progress: Progress) => Promise<R>, meta: { projectId?: string } = {}): Job<R> {
    if ([...this.#map.values()].filter((j) => j.status === 'running').length >= this.#perPerson)
      throw new AppError(429, 'a job of yours is still running: wait for it to finish');
    if (this.#gate && this.#gate.running >= this.#gate.max) throw new AppError(503, 'the server is busy with other people’s work: try again in a minute');
    if (this.#gate) this.#gate.running++;
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
      })
      .finally(() => {
        if (this.#gate) this.#gate.running--;
      });
    return job;
  }
}
