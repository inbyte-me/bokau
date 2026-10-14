import { type AiStatus, AppError } from '@doblaje/core';

export type { AiStatus } from '@doblaje/core';

import type { AiLedger } from '@doblaje/db';

export interface AiConfig {
  /** read lazily so a key added to the environment later is picked up */
  apiKey: () => string;
  openrouterBase: string;
  /** hard local spend cap (USD); calls are refused once the ledger reaches it */
  spendCapUsd: number;
  defaultModel: string;
  fallbackModel: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface CompleteOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  task?: string;
}
export interface Completion {
  text: string;
  model: string;
  costUsd: number;
}

interface Usage {
  cost?: number;
  total_tokens?: number;
}
interface ChatResponse {
  model?: string;
  choices?: { message?: { content?: string } }[];
  usage?: Usage;
  error?: { message?: string };
}

// Conservative fallback if the provider omits cost: assume $1 per 1M tokens.
const estimateCost = (u?: Usage) => ((u?.total_tokens || 0) / 1e6) * 1.0;

/**
 * OpenRouter client with a persistent spend ledger.
 * - the key comes from the environment and is never sent to the browser
 * - every call asks OpenRouter for usage accounting and records `usage.cost`
 * - once the cap is reached calls are refused (402) so callers can fall back to offline generators
 */
export class OpenRouter {
  readonly cfg: AiConfig;
  readonly ledger: AiLedger;
  constructor(cfg: AiConfig, ledger: AiLedger) {
    this.cfg = cfg;
    this.ledger = ledger;
  }
  status(): AiStatus {
    const t = this.ledger.totals();
    return {
      configured: !!this.cfg.apiKey(),
      spentUsd: Math.round(t.usd * 1e6) / 1e6,
      capUsd: this.cfg.spendCapUsd,
      calls: t.calls,
      remainingUsd: Math.max(0, this.cfg.spendCapUsd - t.usd),
      model: this.cfg.defaultModel,
    };
  }

  /** Throws AppError(402/502/503) when unusable so callers can fall back. */
  async complete(messages: ChatMessage[], { model, maxTokens = 700, temperature = 0.9, json = false, task }: CompleteOptions = {}): Promise<Completion> {
    const key = this.cfg.apiKey();
    if (!key) throw new AppError(503, 'OpenRouter key not configured');
    if (this.ledger.totals().usd >= this.cfg.spendCapUsd) throw new AppError(402, `AI spend cap reached ($${this.cfg.spendCapUsd})`);
    const max = Math.min(Math.max(32, maxTokens), 2000); // hard guard against runaway cost
    const tryModel = async (m: string): Promise<Completion> => {
      const body: Record<string, unknown> = { model: m, messages, max_tokens: max, temperature, usage: { include: true }, reasoning: { enabled: false } };
      if (json) body.response_format = { type: 'json_object' };
      const r = await fetch(`${this.cfg.openrouterBase}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(60000),
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Doblaje Studio', 'http-referer': 'http://localhost' },
        body: JSON.stringify(body),
      });
      const data = (await r.json().catch(() => ({}))) as ChatResponse;
      // whatever the provider says back, the key is never repeated in it (messages travel on to browsers)
      if (!r.ok) throw new AppError(r.status === 402 ? 402 : 502, (data?.error?.message || `OpenRouter ${r.status}`).split(key).join('[key]'));
      const text = data.choices?.[0]?.message?.content ?? '';
      // a free model reports a cost of exactly 0: believe it (only a missing cost is estimated from the tokens)
      const cost = typeof data.usage?.cost === 'number' ? data.usage.cost : estimateCost(data.usage);
      this.ledger.record({ model: data.model || m, task, costUsd: cost, tokens: data.usage?.total_tokens || 0 });
      if (!text) throw new AppError(502, 'empty model response');
      return { text, model: data.model || m, costUsd: typeof data.usage?.cost === 'number' ? data.usage.cost : 0 };
    };
    const first = model || this.cfg.defaultModel;
    try {
      return await tryModel(first);
    } catch (e) {
      if ((e instanceof AppError && e.status === 402) || first === this.cfg.fallbackModel) throw e;
      return tryModel(this.cfg.fallbackModel);
    }
  }
}
