import type { WorkerProgress, WorkerReply, WorkerRequest } from './protocol.ts';

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
type Pending = { resolve: (m: WorkerReply) => void; reject: (e: Error) => void; onProgress?: (p: WorkerProgress) => void };
let worker: Worker | null = null;
const pending = new Map<string, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./stt-worker.ts', import.meta.url), { type: 'module', name: 'speech' });
  w.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
    const p = pending.get(data.id);
    if (!p) return;
    if (data.type === 'progress' || data.type === 'status') p.onProgress?.(data);
    else {
      pending.delete(data.id);
      if (data.type === 'error') p.reject(new Error(data.message));
      else p.resolve(data);
    }
  };
  w.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'speech worker crashed'));
    pending.clear();
    worker = null;
  };
  worker = w;
  return w;
}

/** One request to the shared speech worker (models stay loaded between calls). */
export function request<T extends WorkerReply['type']>(
  msg: WithoutId<WorkerRequest>,
  { onProgress, transfer = [] }: { onProgress?: (p: WorkerProgress) => void; transfer?: Transferable[] } = {},
): Promise<Extract<WorkerReply, { type: T }>> {
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (m: WorkerReply) => void, reject, onProgress });
    getWorker().postMessage({ ...msg, id }, transfer);
  });
}
