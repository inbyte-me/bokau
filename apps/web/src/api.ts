// Typed client for the local server (same origin in the browser and in the desktop shell).
import type { AiStatus, EditableProject, Job, Mode, Project, ProjectSummary, RewriteResult, TimeRange } from '@doblaje/core';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Body = Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer> | object | undefined;

async function req<T>(method: string, url: string, body?: Body, opts: { headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
  const isRaw = body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body);
  const r = await fetch(url, {
    method,
    headers: { ...(body && !isRaw ? { 'content-type': 'application/json' } : {}), ...opts.headers },
    body: body ? (isRaw ? (body as BodyInit) : JSON.stringify(body)) : undefined,
    signal: opts.signal,
  });
  const text = await r.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!r.ok) throw new ApiError(r.status, (data as { error?: string })?.error || `HTTP ${r.status}`);
  return data as T;
}

export interface SystemInfo {
  neuralSeparation: boolean;
  ffmpeg: string;
  ai: AiStatus;
  node: string;
  localOnly: boolean;
  electron: string | null;
}
export interface AiInfo extends AiStatus {
  models: readonly { id: string; label: string }[];
  genres: string[];
}
export type RewriteResponse = RewriteResult & { spend: AiStatus };

export const api = {
  get: <T = unknown>(u: string) => req<T>('GET', u),
  post: <T = unknown>(u: string, b?: Body, o?: { headers?: Record<string, string> }) => req<T>('POST', u, b ?? {}, o),
  put: <T = unknown>(u: string, b: Body) => req<T>('PUT', u, b),
  del: <T = unknown>(u: string) => req<T>('DELETE', u),
  raw: <T = unknown>(u: string, blob: Blob, headers?: Record<string, string>) => req<T>('POST', u, blob, { headers }),

  system: () => api.get<SystemInfo>('/api/system'),
  projects: (kind?: 'clips' | 'projects') => api.get<ProjectSummary[]>(`/api/projects${kind ? `?kind=${kind}` : ''}`),
  project: (id: string) => api.get<Project>(`/api/projects/${id}`),
  createProject: (name: string, mode: Mode, { template = false } = {}) => api.post<Project>('/api/projects', { name, mode, template }),
  /** a new project from a library clip */
  derive: (clipId: string, mode: Mode, name?: string) => api.post<Project>(`/api/projects/${clipId}/derive`, { mode, name }),
  savedProject: (id: string, p: Partial<EditableProject>) => api.put<Project>(`/api/projects/${id}`, p),
  deleteProject: (id: string) => api.del<{ ok: true }>(`/api/projects/${id}`),
  speechSegments: (id: string, o: object = {}) => api.post<{ segments: TimeRange[] }>(`/api/projects/${id}/speech-segments`, o),
  startJob: (url: string, body: object = {}) => api.post<{ job: string }>(url, body),
  media: (id: string, name: string) => `/media/${id}/${name}`,
  aiStatus: () => api.get<AiInfo>('/api/ai/status'),

  /** Upload a source video with progress; resolves with the ingest job id. */
  uploadSource(id: string, file: File, onProgress?: (f: number) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', `/api/projects/${id}/source`);
      x.setRequestHeader('x-filename', encodeURIComponent(file.name).replace(/%/g, ''));
      x.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      x.onload = () => {
        try {
          const d = JSON.parse(x.responseText) as { job?: string; error?: string };
          if (x.status < 300 && d.job) resolve(d.job);
          else reject(new Error(d.error || String(x.status)));
        } catch (e) {
          reject(e);
        }
      };
      x.onerror = () => reject(new Error('upload failed'));
      x.send(file);
    });
  },
  async waitJob<R = unknown>(jobId: string, onProgress?: (j: Job<R>) => void, { intervalMs = 400 } = {}): Promise<R> {
    for (;;) {
      const j = await api.get<Job<R>>(`/api/jobs/${jobId}`);
      onProgress?.(j);
      if (j.status === 'done') return j.result as R;
      if (j.status === 'error') throw new Error(j.error || 'job failed');
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  },
};
