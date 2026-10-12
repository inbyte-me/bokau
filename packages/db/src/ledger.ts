import { count, sql, sum } from 'drizzle-orm';
import type { Db } from './client.ts';
import { aiCalls } from './schema.ts';

export interface SpendTotals {
  usd: number;
  calls: number;
  tokens: number;
}
export interface CallRecord {
  model: string;
  task?: string | null;
  costUsd: number;
  tokens?: number;
}

/** Durable record of AI spend; the local cap is checked against these totals before every call. */
export class AiLedger {
  readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  totals(): SpendTotals {
    const r = this.db
      .select({ usd: sum(aiCalls.costUsd).mapWith(Number), calls: count(), tokens: sql<number>`coalesce(sum(${aiCalls.tokens}), 0)`.mapWith(Number) })
      .from(aiCalls)
      .get();
    return { usd: r?.usd || 0, calls: r?.calls || 0, tokens: r?.tokens || 0 };
  }
  record({ model, task = null, costUsd, tokens = 0 }: CallRecord): void {
    this.db
      .insert(aiCalls)
      .values({ at: new Date().toISOString(), model, task, costUsd: Number.isFinite(costUsd) ? costUsd : 0, tokens })
      .run();
  }
}
