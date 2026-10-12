/** Messages between the page and the speech worker. Every request carries an id; replies echo it. */
export type WorkerRequest =
  | { type: 'transcribe'; id: string; audio: Float32Array; model: string; language: string }
  | { type: 'embed'; id: string; model: string; windows: Float32Array[] };

export interface AsrChunkMsg {
  text: string;
  timestamp: [number, number | null];
}
export type WorkerProgress =
  | { type: 'status'; id: string; message: string }
  | { type: 'progress'; id: string; stage: 'download' | 'embed'; pct: number; file?: string };
export type WorkerReply =
  | WorkerProgress
  | { type: 'result'; id: string; text: string; chunks: AsrChunkMsg[] }
  | { type: 'embeddings'; id: string; embeddings: number[][] }
  | { type: 'error'; id: string; message: string };
