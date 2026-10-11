import { uid } from './util.js';

/** Tiny in-memory job tracker; clients poll /api/jobs/:id. */
export class Jobs {
  constructor() { this.map = new Map(); }
  create(kind, meta = {}) {
    const job = { id: 'j' + uid(10), kind, status: 'running', progress: 0, message: '', result: null, error: null, startedAt: Date.now(), ...meta };
    this.map.set(job.id, job);
    if (this.map.size > 200) this.map.delete(this.map.keys().next().value);
    return job;
  }
  get(id) { return this.map.get(id); }
  update(job, patch) { Object.assign(job, patch); }
  done(job, result) { Object.assign(job, { status: 'done', progress: 1, result }); }
  fail(job, err) { Object.assign(job, { status: 'error', error: String(err?.message || err) }); }
  /** Run async fn(job) as a job; returns job immediately. */
  run(kind, fn, meta) {
    const job = this.create(kind, meta);
    Promise.resolve().then(() => fn(job)).then((r) => this.done(job, r ?? null)).catch((e) => { console.error(`[job ${kind}]`, e.message); this.fail(job, e); });
    return job;
  }
}
