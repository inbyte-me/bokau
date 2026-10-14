import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  AppError,
  defaultProject,
  deriveDocument,
  type EditableProject,
  isMode,
  type Mode,
  migrate,
  type Project,
  type ProjectRepository,
  type ProjectSummary,
  summarize,
} from '@doblaje/core';
import { desc, eq } from 'drizzle-orm';
import type { Db } from './client.ts';
import { type ProjectDocument, projects } from './schema.ts';

export const isProjectId = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9_-]{4,40}$/i.test(s);

type Row = typeof projects.$inferSelect;

function toRow(p: Project): Row {
  const { id, name, mode, createdAt, updatedAt, media, stems, template, sourceTemplateId, ...document } = p;
  return { id, name, mode, createdAt, updatedAt, media, stems, template, sourceTemplateId, document: document satisfies ProjectDocument };
}
function fromRow(r: Row): Project {
  return migrate({
    ...r.document,
    id: r.id,
    name: r.name,
    mode: r.mode,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    media: r.media,
    stems: r.stems,
    template: r.template,
    sourceTemplateId: r.sourceTemplateId,
  });
}

/** Files a derived project shares with its library clip (read-only media; recordings are never shared). */
const SHARED_MEDIA = /^(source\.\w+|proxy\.mp4|poster\.jpg|thumbs\.jpg|audio_orig\.wav|audio_16k\.wav|stem_dialogue\.wav|stem_bg\.wav)$/;

/** What the repository needs from the library's vault (see the api package): whether a clip is stored encrypted, and a way to open it. */
export interface ClipVault {
  isSealed(dir: string): boolean;
  /** decrypt the files of a sealed clip whose names pass `keep` into another folder */
  open(from: string, to: string, keep: (name: string) => boolean): void;
}

/** Projects in SQLite; their media files in `<projectsDir>/<id>/`. */
export class SqliteProjectRepository implements ProjectRepository {
  readonly db: Db;
  readonly projectsDir: string;
  readonly #vault: ClipVault | null;
  constructor(db: Db, projectsDir: string, vault: ClipVault | null = null) {
    this.db = db;
    this.projectsDir = projectsDir;
    this.#vault = vault;
    fs.mkdirSync(projectsDir, { recursive: true });
  }

  dir(id: string): string {
    if (!isProjectId(id)) throw new AppError(400, 'bad project id');
    return path.join(this.projectsDir, id);
  }
  file(id: string, name: string): string {
    if (!/^[\w.-]+(\/[\w.-]+)*$/.test(name) || name.includes('..')) throw new AppError(400, 'bad file name');
    return path.join(this.dir(id), name);
  }
  exists(id: string): boolean {
    return isProjectId(id) && !!this.db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get();
  }
  create({ name, mode, template = false }: { name?: string; mode?: Mode | string; template?: boolean }): Project {
    const id = `p${crypto.randomBytes(5).toString('hex').slice(0, 9)}`;
    fs.mkdirSync(path.join(this.dir(id), 'takes'), { recursive: true });
    const p = defaultProject({ id, name: (name || 'Untitled').slice(0, 120), mode: isMode(mode) ? mode : 'pro' });
    p.template = template;
    this.db.insert(projects).values(toRow(p)).run();
    return p;
  }
  get(id: string): Project {
    if (!isProjectId(id)) throw new AppError(400, 'bad project id');
    const r = this.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!r) throw new AppError(404, 'project not found');
    return fromRow(r);
  }
  save(p: Project): Project {
    p.updatedAt = new Date().toISOString();
    const row = toRow(p);
    this.db.insert(projects).values(row).onConflictDoUpdate({ target: projects.id, set: row }).run();
    return p;
  }
  update(id: string, patch: Partial<EditableProject> & Record<string, unknown>): Project {
    const cur = this.get(id);
    const { media: _m, stems: _s, id: _i, createdAt: _c, template: _t, sourceTemplateId: _st, ...editable } = patch || {};
    const next = migrate({
      ...cur,
      ...editable,
      media: cur.media,
      stems: cur.stems,
      id: cur.id,
      createdAt: cur.createdAt,
      template: cur.template,
      sourceTemplateId: cur.sourceTemplateId,
    } as Project);
    return this.save(next);
  }
  list(filter: { template?: boolean } = {}): ProjectSummary[] {
    return this.db
      .select()
      .from(projects)
      .where(filter.template === undefined ? undefined : eq(projects.template, filter.template))
      .orderBy(desc(projects.updatedAt))
      .all()
      .map((r) => summarize(fromRow(r)));
  }
  derive(templateId: string, { name, mode }: { name?: string; mode: Mode }): Project {
    const clip = this.get(templateId);
    if (!clip.template) throw new AppError(400, 'not a library clip');
    if (!clip.media?.ready) throw new AppError(409, 'the clip is still being prepared');
    const p = this.create({ name: name || clip.name, mode });
    const from = this.dir(clip.id);
    const to = this.dir(p.id);
    if (fs.existsSync(path.join(from, 'sealed.json'))) {
      // a library clip kept encrypted: the round gets a decrypted working copy (deleted with the round), never a link
      if (!this.#vault?.isSealed(from)) throw new AppError(500, 'this clip is sealed and the server has no library key');
      this.#vault.open(from, to, (name) => SHARED_MEDIA.test(name));
      return this.save(deriveDocument(clip, p));
    }
    for (const f of fs.readdirSync(from).filter((x) => SHARED_MEDIA.test(x))) {
      try {
        fs.linkSync(path.join(from, f), path.join(to, f)); // same bytes, no extra disk space
      } catch {
        fs.copyFileSync(path.join(from, f), path.join(to, f)); // another volume
      }
    }
    return this.save(deriveDocument(clip, p));
  }
  remove(id: string): void {
    const dir = this.dir(id);
    this.db.delete(projects).where(eq(projects.id, id)).run();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
