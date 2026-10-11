import fs from 'node:fs';
import path from 'node:path';
import { HttpError, readJsonFile, writeJsonAtomic } from './util.js';

/**
 * OpenRouter client with a persistent local spend ledger.
 * - key comes from env (OPENROUTER_API_KEY, loaded from .env) and is never sent to the browser
 * - every call asks OpenRouter for usage accounting; we add up `usage.cost`
 * - once the cap is reached, calls are refused (the app falls back to offline heuristics)
 */
export class AI {
  constructor(cfg) {
    this.cfg = cfg;
    this.ledgerFile = path.join(cfg.dataDir, 'ai-ledger.json');
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    this.ledger = readJsonFile(this.ledgerFile, { usd: 0, calls: 0, tokens: 0 });
  }
  get key() { return process.env.OPENROUTER_API_KEY || ''; }
  status() {
    return { configured: !!this.key, spentUsd: Math.round(this.ledger.usd * 1e6) / 1e6, capUsd: this.cfg.spendCapUsd, calls: this.ledger.calls, remainingUsd: Math.max(0, this.cfg.spendCapUsd - this.ledger.usd), model: this.cfg.defaultModel };
  }
  record(cost, tokens) {
    this.ledger.usd += cost || 0; this.ledger.calls += 1; this.ledger.tokens += tokens || 0;
    writeJsonAtomic(this.ledgerFile, this.ledger);
  }
  /**
   * messages: [{role,content}]; opts: {model,maxTokens,temperature,json}
   * Returns {text, model, costUsd}. Throws HttpError(402/503) when unusable so callers can fall back.
   */
  async complete(messages, { model, maxTokens = 700, temperature = 0.9, json = false } = {}) {
    if (!this.key) throw new HttpError(503, 'OpenRouter key not configured');
    if (this.ledger.usd >= this.cfg.spendCapUsd) throw new HttpError(402, `AI spend cap reached ($${this.cfg.spendCapUsd})`);
    maxTokens = Math.min(Math.max(32, maxTokens), 2000); // hard guard against runaway cost
    const tryModel = async (m) => {
      const body = { model: m, messages, max_tokens: maxTokens, temperature, usage: { include: true }, reasoning: { enabled: false } };
      if (json) body.response_format = { type: 'json_object' };
      const r = await fetch(`${this.cfg.openrouterBase}/chat/completions`, {
        method: 'POST', signal: AbortSignal.timeout(60000),
        headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json', 'x-title': 'Doblaje Studio', 'http-referer': 'http://localhost' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new HttpError(r.status === 402 ? 402 : 502, data?.error?.message || `OpenRouter ${r.status}`);
      const text = data.choices?.[0]?.message?.content ?? '';
      this.record(Number(data.usage?.cost) || estimateCost(data.usage), data.usage?.total_tokens);
      if (!text) throw new HttpError(502, 'empty model response');
      return { text, model: data.model || m, costUsd: Number(data.usage?.cost) || 0 };
    };
    const first = model || this.cfg.defaultModel;
    try { return await tryModel(first); }
    catch (e) {
      if (e.status === 402 || first === this.cfg.fallbackModel) throw e;
      return tryModel(this.cfg.fallbackModel);
    }
  }
}

// Conservative fallback if the provider omits cost: assume $1/M tokens.
const estimateCost = (u) => ((u?.total_tokens || 0) / 1e6) * 1.0;
