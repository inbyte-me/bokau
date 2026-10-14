// Request/response shapes shared by the server and the browser (the HTTP contract).

export const AI_TASKS = ['translate', 'badlip', 'telenovela', 'genre'] as const;
export type AiTask = (typeof AI_TASKS)[number];

export interface AiStatus {
  configured: boolean;
  spentUsd: number;
  capUsd: number;
  calls: number;
  remainingUsd: number;
  model: string;
}

export interface RewriteParams {
  model?: string;
  fromLang?: string;
  outLang?: string;
  prompt?: string;
  genre?: string;
  extra?: string;
  /** skip the network and use the offline generator */
  offline?: boolean;
}
export interface RewriteCueInput {
  id: string | number;
  text?: string;
  character?: string;
  dur?: number;
  start?: number;
  end?: number;
  syl?: number;
}
export interface RewrittenLine {
  id: string;
  text: string;
  character: string;
  direction: string;
  syllables: number;
  target: number;
  changed: boolean;
}
export interface RewriteResult {
  lines: RewrittenLine[];
  source: 'ai' | 'offline';
  model: string | null;
  costUsd: number;
  notice: string | null;
}

/** A background track in the sound library (`GET /api/sounds`); served at `url`. */
export interface Sound {
  id: string;
  name: string;
  duration: number;
  createdAt: string;
  url: string;
}
