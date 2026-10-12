/** Background work on the server (ingest, stems, export) is reported as a job the client polls. */
export type JobStatus = 'running' | 'done' | 'error';
export type JobKind = 'ingest' | 'stems' | 'export' | 'podcast-export';

export interface Job<R = unknown> {
  id: string;
  kind: JobKind;
  status: JobStatus;
  /** 0..1 */
  progress: number;
  message: string;
  result: R | null;
  error: string | null;
  startedAt: number;
  projectId?: string;
}

/** Progress sink handed to long-running media functions. */
export type Progress = (fraction: number, message: string) => void;
