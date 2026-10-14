import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppError, type Sound } from '@doblaje/core';
import { desc, eq } from 'drizzle-orm';
import type { Db } from './client.ts';
import { sounds } from './schema.ts';

export const isSoundId = (s: unknown): s is string => typeof s === 'string' && /^s[a-f0-9]{10}$/.test(s);

/** The background-audio library: rows in SQLite, one AAC file per sound in `<dir>/<id>.m4a`. */
export class SoundRepository {
  readonly db: Db;
  readonly dir: string;
  constructor(db: Db, dir: string) {
    this.db = db;
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }
  newId(): string {
    return `s${crypto.randomBytes(5).toString('hex')}`;
  }
  file(id: string): string {
    if (!isSoundId(id)) throw new AppError(400, 'bad sound id');
    return path.join(this.dir, `${id}.m4a`);
  }
  add(id: string, { name, duration }: { name: string; duration: number }): Sound {
    const row = { id, name: name.slice(0, 120) || 'Sound', duration, createdAt: new Date().toISOString() };
    this.db.insert(sounds).values(row).run();
    return toSound(row);
  }
  list(): Sound[] {
    return this.db.select().from(sounds).orderBy(desc(sounds.createdAt)).all().map(toSound);
  }
  rename(id: string, name: string): Sound {
    this.db
      .update(sounds)
      .set({ name: name.slice(0, 120) })
      .where(eq(sounds.id, id))
      .run();
    const r = this.db.select().from(sounds).where(eq(sounds.id, id)).get();
    if (!r) throw new AppError(404, 'sound not found');
    return toSound(r);
  }
  remove(id: string): void {
    this.db.delete(sounds).where(eq(sounds.id, id)).run();
    fs.rmSync(this.file(id), { force: true });
  }
}

const toSound = (r: typeof sounds.$inferSelect): Sound => ({ ...r, url: `/sounds/${r.id}.m4a` });
