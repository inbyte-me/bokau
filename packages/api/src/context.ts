import type { OpenRouter } from '@doblaje/ai';
import type { ProjectRepository } from '@doblaje/core';
import type { Db } from '@doblaje/db';
import type { AppConfig } from './config.ts';
import type { Jobs } from './jobs.ts';

/** Everything a route needs, built once in createApp(). */
export interface AppContext {
  cfg: AppConfig;
  db: Db;
  projects: ProjectRepository;
  jobs: Jobs;
  ai: OpenRouter;
  ffmpegVersion: string;
  /** true when bound to a loopback address (enables local-file features such as /from-path) */
  localOnly: boolean;
}
