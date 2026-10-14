import { eq } from 'drizzle-orm';
import type { Db } from './client.ts';
import { clipOwners, users } from './schema.ts';

export interface User {
  id: string;
  name: string;
}

/** The people who host rooms, and which library clips are theirs. */
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

  /** The library clip is this person's (and nobody else's). */
  claim(clipId: string, ownerId: string): void {
    this.#db
      .insert(clipOwners)
      .values({ clipId, ownerId, createdAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: clipOwners.clipId, set: { ownerId } })
      .run();
  }

  /** The clip is part of the starter pack again. */
  release(clipId: string): void {
    this.#db.delete(clipOwners).where(eq(clipOwners.clipId, clipId)).run();
  }

  ownerOf(clipId: string): string | null {
    return this.#db.select().from(clipOwners).where(eq(clipOwners.clipId, clipId)).get()?.ownerId ?? null;
  }

  /** The ids of the clips someone owns. */
  ownedBy(ownerId: string): string[] {
    return this.#db
      .select()
      .from(clipOwners)
      .where(eq(clipOwners.ownerId, ownerId))
      .all()
      .map((r) => r.clipId);
  }

  /** May this person (nobody: an anonymous room) use this clip? Starter-pack clips are for everyone; owned ones for their owner. */
  mayUse(clipId: string, personId: string | null): boolean {
    const owner = this.ownerOf(clipId);
    return owner === null || owner === personId;
  }
}
