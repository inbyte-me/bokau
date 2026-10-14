// A signed-in person's own studio on a server of accounts: their database, projects, sounds, AI ledger and job queue, in a
// folder of their own (`<data>/users/<id>/`). Nothing is shared with other people, so nothing needs a permission check:
// a request is answered from the workspace of the person who made it, and no route can name another one.
import fs from 'node:fs';
import path from 'node:path';
import { OpenRouter } from '@doblaje/ai';
import { AppError, type ProjectRepository } from '@doblaje/core';
import { AiLedger, type ClipVault, closeDatabase, type Db, openDatabase, SoundRepository, SqliteProjectRepository } from '@doblaje/db';
import type { AppConfig } from './config.ts';
import { Gate, Jobs } from './jobs.ts';
import type { Router } from './router.ts';

export interface Workspace {
  id: string;
  dir: string;
  db: Db;
  projects: ProjectRepository;
  sounds: SoundRepository;
  ai: OpenRouter;
  jobs: Jobs;
  /** the studio's routes, answering from this workspace only */
  router: Router;
  /** whether the person has room left for more files */
  assertSpace(): void;
  usedBytes(): number;
}

/** What a workspace needs from the rest of the server to build its routes. */
export type WorkspaceParts = Pick<Workspace, 'id' | 'db' | 'projects' | 'sounds' | 'ai' | 'jobs'>;

const ID = /^[A-Za-z0-9_]{3,80}$/;

function sizeOf(dir: string): number {
  let total = 0;
  for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const f = path.join(dir, e.name);
    total += e.isDirectory() ? sizeOf(f) : e.isFile() ? fs.statSync(f).size : 0;
  }
  return total;
}

export class Workspaces {
  readonly #base: string;
  readonly #cfg: AppConfig;
  readonly #vault: ClipVault | null;
  readonly #build: (parts: WorkspaceParts) => Router;
  readonly #gate: Gate;
  readonly #open = new Map<string, Workspace>();

  constructor({ cfg, vault, build }: { cfg: AppConfig; vault: ClipVault | null; build: (parts: WorkspaceParts) => Router }) {
    this.#cfg = cfg;
    this.#base = path.join(cfg.dataDir, 'users');
    this.#vault = vault;
    this.#build = build;
    this.#gate = new Gate(cfg.party.maxJobs);
  }

  /** Where a person's files live (the folder is created with their workspace). */
  dirOf(userId: string): string {
    if (!ID.test(userId)) throw new AppError(400, 'bad user id');
    return path.join(this.#base, userId);
  }

  /** The person's workspace, made on first use and kept for the life of the server (their rooms and jobs use it). */
  get(userId: string): Workspace {
    const known = this.#open.get(userId);
    if (known) return known;
    const dir = this.dirOf(userId);
    fs.mkdirSync(dir, { recursive: true });
    const db = openDatabase({ file: path.join(dir, 'doblaje.db'), migrationsFolder: this.#cfg.migrationsDir });
    const projects = new SqliteProjectRepository(db, path.join(dir, 'projects'), this.#vault);
    const sounds = new SoundRepository(db, path.join(dir, 'sounds'));
    // their own AI budget, in their own ledger: one person cannot spend the server's
    const ai = new OpenRouter({ ...this.#cfg.ai, spendCapUsd: this.#cfg.party.userAiCapUsd }, new AiLedger(db));
    const jobs = new Jobs({ perPerson: 1, gate: this.#gate });
    const quota = this.#cfg.party.userQuotaBytes;
    // measured on each check: only uploads and other POSTs ask, and a stale number would let a full library keep growing
    const usedBytes = () => sizeOf(path.join(dir, 'projects')) + sizeOf(path.join(dir, 'sounds'));
    const parts: WorkspaceParts = { id: userId, db, projects, sounds, ai, jobs };
    const ws: Workspace = {
      ...parts,
      dir,
      router: this.#build(parts),
      usedBytes,
      assertSpace: () => {
        if (usedBytes() >= quota)
          throw new AppError(413, `your library is full (${Math.round(quota / 1024 ** 2)} MB): delete clips or recordings you no longer need`);
      },
    };
    this.#open.set(userId, ws);
    return ws;
  }

  close(): void {
    for (const ws of this.#open.values()) closeDatabase(ws.db);
    this.#open.clear();
  }
}
