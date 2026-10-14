import { eq } from 'drizzle-orm';
import type { Db } from './client.ts';
import { users } from './schema.ts';

export interface User {
  id: string;
  name: string;
}

/** The people who host rooms (their clips are in workspaces of their own, not here). */
export class UserRepository {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  /** A person has signed in: remember them (and their name as the identity provider has it now). */
  touch({ id, name }: User): User {
    const now = new Date().toISOString();
    const clean = name.trim().slice(0, 80) || 'Host';
    this.#db
      .insert(users)
      .values({ id, name: clean, createdAt: now, lastSeenAt: now })
      .onConflictDoUpdate({ target: users.id, set: { name: clean, lastSeenAt: now } })
      .run();
    return { id, name: clean };
  }

  get(id: string): User | null {
    const r = this.#db.select().from(users).where(eq(users.id, id)).get();
    return r ? { id: r.id, name: r.name } : null;
  }
}
