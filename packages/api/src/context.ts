import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OpenRouter } from '@doblaje/ai';
import type { ProjectRepository } from '@doblaje/core';
import type { Db, SoundRepository, UserRepository } from '@doblaje/db';
import type { Auth, Person } from './auth/index.ts';
import type { AppConfig } from './config.ts';
import type { Jobs } from './jobs.ts';
import type { PartyHub } from './party/hub.ts';
import type { Workspaces } from './workspace.ts';

/** Everything a route needs, built once in createApp(). */
export interface AppContext {
  cfg: AppConfig;
  db: Db;
  projects: ProjectRepository;
  sounds: SoundRepository;
  party: PartyHub;
  auth: Auth;
  users: UserRepository;
  /** every signed-in person's own studio (a server of accounts) */
  workspaces: Workspaces;
  /** who is hosting: the signed-in person (renewing their session cookie when the provider did), or null */
  personOf(req: IncomingMessage, res: ServerResponse): Promise<Person | null>;
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
