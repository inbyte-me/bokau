import type { IncomingMessage } from 'node:http';
import type { OpenRouter } from '@doblaje/ai';
import type { ProjectRepository } from '@doblaje/core';
import type { Db, SoundRepository } from '@doblaje/db';
import type { AppConfig } from './config.ts';
import type { Jobs } from './jobs.ts';
import type { PartyHub } from './party/hub.ts';

/** Everything a route needs, built once in createApp(). */
export interface AppContext {
  cfg: AppConfig;
  db: Db;
  projects: ProjectRepository;
  sounds: SoundRepository;
  party: PartyHub;
  /** where phones join (https://<lan-ip>:<port>, or the configured public URL); null until listening */
  partyBase(): string | null;
  jobs: Jobs;
  ai: OpenRouter;
  ffmpegVersion: string;
  /** may this request open one more room? (limited per address) */
  createRoomAllowed(req: IncomingMessage): boolean;
  /** true when bound to a loopback address (enables local-file features such as /from-path) */
  localOnly: boolean;
}
