// Try models on what party games really ask of them, with guests who are crude on purpose, and say which ones play along.
//   pnpm probe:models                      the models the party server defaults to (free first, then the cheap ones)
//   pnpm probe:models vendor/model:free …  any models you want to compare
// Needs OPENROUTER_API_KEY (from the environment or .env). It spends a few cents at most (free models: nothing); the
// verdicts are measured here, not read from a model card: a refusal, a lecture or unusable JSON counts against a model.
import fs from 'node:fs';
import { cleanSuggestion, SUGGEST_SYSTEM, suggestionPrompt } from './party.ts';
import { COMPOSE_SYSTEM, COPY_SYSTEM, composePrompt, parseCopy, trailerPrompt } from './trailer.ts';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error('Set OPENROUTER_API_KEY (environment or .env).');
  process.exit(1);
}
const DEFAULTS = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'google/gemma-4-31b-it:free',
  'thinkingmachines/inkling:free',
  'deepseek/deepseek-v4.1-flash',
  'inclusionai/ling-3.1-flash',
  'qwen/qwen3.7-flash',
  'anthropic/claude-haiku-5.5',
];
const models = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS;

const crudeEn = 'shut the fuck up you stupid cunt, I will shove this spatula up your ass';
const crudeEs = 'cállate la puta boca, hijo de la chingada, te voy a meter la cuchara por el culo';
const copyJob = (said: string[], language: string) => ({
  language,
  scene: 'The Heist',
  logline: language === 'es' ? 'dos pendejos roban un queso gigante en el banco' : 'two assholes rob a giant cheese from a bank',
  title: '',
  directions: said.map((_, i) => `direction ${i + 1}`),
  said,
  critics: 1,
});

interface Test {
  name: string;
  system: string;
  user: string;
  json?: boolean;
  /** is the answer usable? */
  ok: (text: string) => boolean;
}
const tests: Test[] = [
  ...(['en', 'es'] as const).map((language) => ({
    name: `suggestion (${language}, crude previous line)`,
    system: SUGGEST_SYSTEM,
    user: suggestionPrompt({
      scene: 'Kitchen',
      character: 'Ana',
      original: 'Muy bien',
      seconds: 1.5,
      previous: { character: 'Beto', original: 'Please stop talking', said: language === 'es' ? crudeEs : crudeEn },
      language,
    }),
    ok: (t: string) => cleanSuggestion(t) !== null,
  })),
  {
    name: 'direction (crude story, character card)',
    system: COMPOSE_SYSTEM,
    user: composePrompt({
      kind: 'direction',
      language: 'en',
      scene: 'The Heist',
      logline: 'two assholes rob a giant cheese dick from a bank',
      before: 'they shit themselves in the vault',
      character: { name: 'Beto', card: 'gruff, drunk, hates everybody' },
    }),
    ok: (t: string) => cleanSuggestion(t) !== null,
  },
  ...(['en', 'es'] as const).map((language) => {
    const job = copyJob(
      language === 'es'
        ? [crudeEs, 'está llena de pura mierda y queso, hijos de puta', 'corre pendejo corre']
        : [crudeEn, 'it is full of shit and cheese, motherfuckers', 'run you dumb fuck run'],
      language,
    );
    return {
      name: `trailer words (${language}, crude takes, JSON)`,
      system: COPY_SYSTEM,
      user: trailerPrompt(job),
      json: true,
      ok: (t: string) => parseCopy(t, job) !== null,
    };
  }),
];

async function ask(model: string, t: Test) {
  const started = Date.now();
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(90_000),
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Doblaje Studio probe', 'http-referer': 'http://localhost' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: t.system },
          { role: 'user', content: t.user },
        ],
        max_tokens: 400,
        temperature: 1,
        usage: { include: true },
        reasoning: { enabled: false },
        ...(t.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
      usage?: { cost?: number };
      error?: { message?: string };
    };
    const seconds = (Date.now() - started) / 1000;
    if (!r.ok) return { verdict: `ERROR ${r.status} ${body.error?.message?.slice(0, 70) ?? ''}`, seconds, cost: 0, text: '' };
    const text = (body.choices?.[0]?.message?.content ?? '').trim();
    return { verdict: t.ok(text) ? 'ok' : 'UNUSABLE', seconds, cost: body.usage?.cost ?? 0, text };
  } catch (e) {
    return { verdict: `ERROR ${e instanceof Error ? e.message : e}`, seconds: (Date.now() - started) / 1000, cost: 0, text: '' };
  }
}

const summary: Record<string, { ok: number; total: number; cost: number; seconds: number }> = {};
for (const model of models) {
  console.log(`\n${model}`);
  const s = (summary[model] = { ok: 0, total: 0, cost: 0, seconds: 0 });
  for (const t of tests) {
    const r = await ask(model, t);
    s.total++;
    s.ok += r.verdict === 'ok' ? 1 : 0;
    s.cost += r.cost;
    s.seconds += r.seconds;
    console.log(
      `  ${r.verdict === 'ok' ? 'ok      ' : r.verdict.slice(0, 8).padEnd(8)} ${t.name.padEnd(46)} ${r.seconds.toFixed(1)}s  ${r.text.replace(/\s+/g, ' ').slice(0, 70)}${r.verdict.startsWith('ERROR') || r.verdict === 'UNUSABLE' ? `  [${r.verdict}]` : ''}`,
    );
  }
}
console.log('\nsummary (usable answers, mean seconds, total cost)');
for (const [model, s] of Object.entries(summary))
  console.log(`  ${`${s.ok}/${s.total}`.padEnd(5)} ${(s.seconds / s.total).toFixed(1).padStart(5)}s  $${s.cost.toFixed(5)}  ${model}`);
