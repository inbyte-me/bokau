import assert from 'node:assert/strict';
import test from 'node:test';
import { countText } from '@doblaje/core';
import { mockOpenRouter as mockUpstream, startApp } from '@doblaje/testkit';

const reply = (lines, cost = 0.0001) => ({
  json: { model: 'mock/model', choices: [{ message: { content: JSON.stringify({ lines }) } }], usage: { cost, total_tokens: 300 } },
});
const cues = [
  { id: 'a', text: 'Hello there my friend', start: 0, end: 2 },
  { id: 'b', text: 'I would like a cup of coffee', start: 2, end: 5 },
];

test('rewrite: request shape (cheap default model, usage accounting, bounded tokens), result mapping, spend ledger', async () => {
  const up = await mockUpstream((b) =>
    reply(
      b.messages.at(-1).content.includes('"id":"a"')
        ? [
            { id: 'a', text: 'Greetings to you pal', character: 'Ann' },
            { id: 'b', text: 'Give me a big cup of joe now', direction: 'smug' },
          ]
        : [],
    ),
  );
  const app = await startApp({ ai: { openrouterBase: up.url } });
  try {
    const r = await app.api('POST', '/api/ai/rewrite', { task: 'badlip', cues, params: { prompt: 'arguing about cheese', outLang: 'en' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.source, 'ai');
    assert.equal(r.data.lines[0].text, 'Greetings to you pal');
    assert.equal(r.data.lines[0].character, 'Ann');
    assert.equal(r.data.lines[1].direction, 'smug');
    assert.equal(r.data.lines[0].syllables, countText('Greetings to you pal', 'en'));
    const q = up.reqs[0];
    assert.equal(q.headers.authorization, 'Bearer test-key-not-real');
    assert.equal(q.body.model, 'qwen/qwen3.7-flash');
    assert.deepEqual(q.body.usage, { include: true });
    assert.ok(q.body.max_tokens <= 2000);
    assert.ok(q.body.messages.at(-1).content.includes('arguing about cheese'));
    assert.ok(r.data.spend.spentUsd > 0);
    const s = await app.api('GET', '/api/ai/status');
    assert.ok(s.data.models.length >= 3 && s.data.models[0].id === 'qwen/qwen3.7-flash');
    assert.ok(!JSON.stringify(s.data).includes('test-key'));
  } finally {
    await app.close();
    await up.close();
  }
});

test('rewrite: syllable repair pass re-asks only lines that are off, keeps improvements', async () => {
  const want = countText('Hello there my friend', 'en');
  let calls = 0;
  const up = await mockUpstream((b) => {
    calls++;
    if (calls === 1)
      return reply([
        { id: 'a', text: 'Hi' },
        { id: 'b', text: 'I would like a cup of coffee' },
      ]); // 'a' far from target
    assert.ok(b.messages.at(-1).content.includes('previous'), 'repair prompt mentions previous attempt');
    assert.ok(!b.messages.at(-1).content.includes('"id":"b"'), 'only bad lines re-asked');
    return reply([{ id: 'a', text: 'Hello there my pal' }]);
  });
  const app = await startApp({ ai: { openrouterBase: up.url } });
  try {
    const r = await app.api('POST', '/api/ai/rewrite', { task: 'badlip', cues, params: { outLang: 'en' } });
    assert.equal(calls, 2);
    assert.equal(r.data.lines[0].text, 'Hello there my pal');
    assert.equal(r.data.lines[0].syllables, want);
  } finally {
    await app.close();
    await up.close();
  }
});

test('rewrite: unknown model is ignored (cost safety); fallback model used when first fails', async () => {
  const up = await mockUpstream((_b, n) =>
    n === 1
      ? { status: 500, json: { error: { message: 'boom' } } }
      : reply([
          { id: 'a', text: 'Ahoy there matey' },
          { id: 'b', text: 'Pass the grog' },
        ]),
  );
  const app = await startApp({ ai: { openrouterBase: up.url } });
  try {
    const r = await app.api('POST', '/api/ai/rewrite', { task: 'genre', cues, params: { genre: 'pirate', model: 'openai/o3-pro' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.source, 'ai');
    assert.equal(up.reqs[0].body.model, 'qwen/qwen3.7-flash', 'expensive/unknown model refused');
    assert.equal(up.reqs[1].body.model, 'anthropic/claude-haiku-5.5', 'fallback');
  } finally {
    await app.close();
    await up.close();
  }
});

test('spend cap: once reached, no more upstream calls; party tasks fall back offline, translate reports 402', async () => {
  const up = await mockUpstream(() =>
    reply(
      [
        { id: 'a', text: 'Hello there pal' },
        { id: 'b', text: 'Cup of coffee please' },
      ],
      0.02,
    ),
  );
  const app = await startApp({ ai: { openrouterBase: up.url, spendCapUsd: 0.03 } });
  try {
    await app.api('POST', '/api/ai/rewrite', { task: 'telenovela', cues, params: {} });
    await app.api('POST', '/api/ai/rewrite', { task: 'telenovela', cues, params: {} });
    const n = up.reqs.length;
    const r = await app.api('POST', '/api/ai/rewrite', { task: 'telenovela', cues, params: {} });
    assert.equal(r.data.source, 'offline');
    assert.match(r.data.notice, /cap/i);
    assert.equal(up.reqs.length, n, 'no upstream call after cap');
    const t = await app.api('POST', '/api/ai/rewrite', { task: 'translate', cues, params: { outLang: 'es' } });
    assert.equal(t.status, 402);
    const status = await app.api('GET', '/api/ai/status');
    assert.ok(status.data.spentUsd >= 0.03, 'spend is persisted in the database ledger');
  } finally {
    await app.close();
    await up.close();
  }
});

test('no API key: offline party tasks still work and respect syllable slots; translate says unavailable', async () => {
  const saved = process.env.OPENROUTER_API_KEY;
  const app = await startApp({ apiKey: '' });
  try {
    const slots = [
      { id: 's1', text: '', start: 0, end: 2 },
      { id: 's2', text: '', start: 2, end: 3 },
    ];
    const b = await app.api('POST', '/api/ai/rewrite', {
      task: 'badlip',
      cues: [
        { ...slots[0], syl: 7 },
        { ...slots[1], syl: 3 },
      ],
      params: { prompt: 'lost cheese', outLang: 'en' },
    });
    assert.equal(b.status, 200);
    assert.equal(b.data.source, 'offline');
    assert.equal(b.data.lines[0].syllables, 7);
    assert.equal(b.data.lines[1].syllables, 3);
    for (const g of ['pirate', 'noir', 'corporate', 'action80s']) {
      const r = await app.api('POST', '/api/ai/rewrite', { task: 'genre', cues, params: { genre: g } });
      assert.equal(r.data.source, 'offline');
      assert.ok(
        r.data.lines.every((l) => l.text.length > 5),
        g,
      );
    }
    const t = await app.api('POST', '/api/ai/rewrite', { task: 'telenovela', cues: [{ id: 'x', text: 'Hola, quiero un café', start: 0, end: 2 }], params: {} });
    assert.match(t.data.lines[0].text, /[¡¿]/, 'Spanish input gets Spanish drama');
    assert.equal((await app.api('POST', '/api/ai/rewrite', { task: 'translate', cues, params: { outLang: 'es' } })).status, 503);
    assert.equal((await app.api('POST', '/api/ai/rewrite', { task: 'nope', cues, params: {} })).status, 400);
    assert.equal((await app.api('POST', '/api/ai/rewrite', { task: 'genre', cues: [], params: {} })).status, 400);
  } finally {
    await app.close();
    process.env.OPENROUTER_API_KEY = saved;
  }
});

test('garbage model output degrades to offline for party tasks', async () => {
  const up = await mockUpstream(() => ({ json: { choices: [{ message: { content: 'sorry, I cannot do JSON' } }], usage: { cost: 0.0001 } } }));
  const app = await startApp({ ai: { openrouterBase: up.url } });
  try {
    const r = await app.api('POST', '/api/ai/rewrite', { task: 'genre', cues, params: { genre: 'noir' } });
    assert.equal(r.data.source, 'offline');
    assert.match(r.data.notice, /JSON/);
  } finally {
    await app.close();
    await up.close();
  }
});

test('a free model costs nothing: its reported cost of 0 is believed, not replaced by an estimate from the tokens', async () => {
  const up = await mockUpstream(() => ({
    json: {
      model: 'vendor/free-model:free',
      choices: [{ message: { content: JSON.stringify({ lines: [{ id: 'a', text: 'Hi pal' }] }) } }],
      usage: { cost: 0, total_tokens: 5000 },
    },
  }));
  const app = await startApp({ ai: { openrouterBase: up.url, defaultModel: 'vendor/free-model:free' } });
  try {
    const r = await app.api('POST', '/api/ai/rewrite', { task: 'badlip', cues: [cues[0]], params: { prompt: 'x', outLang: 'en' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await app.api('GET', '/api/ai/status')).data.spentUsd, 0, 'nothing spent');
  } finally {
    await app.close();
    await up.close();
  }
});

test('party games use their own pair of models: a free one first, a cheap one when the free one runs out of requests', async () => {
  const up = await mockUpstream((b) =>
    b.model === 'vendor/free-model:free'
      ? { status: 429, json: { error: { message: 'free models are limited to 50 requests a day' } } }
      : { json: { model: b.model, choices: [{ message: { content: 'Mi pato tiene hambre' } }], usage: { cost: 0.00001, total_tokens: 50 } } },
  );
  const app = await startApp({
    ai: { openrouterBase: up.url },
    party: { aiModel: 'vendor/free-model:free', aiFallback: 'vendor/cheap-model' },
  });
  try {
    const { code, hostKey } = (await app.api('POST', '/api/party/rooms')).data;
    // a dub round with the suggestion asked for the first line
    const { Client } = await import('./support/party.ts');
    const clipId = await app.ingestFixture('clip_voices.mp4', 'pro', { template: true });
    await app.api('PUT', `/api/projects/${clipId}`, {
      speakers: { list: [{ id: 'A', name: 'Ana', color: '#d97b66', muted: false, solo: false }], segments: [] },
      cues: [{ id: 'c1', start: 0.5, end: 2, text: 'Hola, ¿qué tal?', character: 'Ana', note: '' }],
    });
    const host = new Client(app.base);
    await host.open();
    host.send({ type: 'hello-player', code, name: 'Pau', hostKey });
    host.send({ type: 'host', command: { type: 'pick-clip', clipId } });
    host.send({ type: 'host', command: { type: 'cast' } });
    await host.view((v) => (v as { board?: { phase: string } }).board?.phase === 'casting');
    host.send({ type: 'host', command: { type: 'begin' } });
    const mine = await host.view((v) => !!(v as { line?: { suggestion?: string } }).line?.suggestion);
    assert.equal((mine as { line: { suggestion: string } }).line.suggestion, 'Mi pato tiene hambre');
    assert.deepEqual(
      up.reqs.map((r) => r.body.model),
      ['vendor/free-model:free', 'vendor/cheap-model'],
      'the free model was asked first, then the cheap one answered',
    );
    host.close();
  } finally {
    await app.close();
    await up.close();
  }
});
