// Party rooms over the real server: a TV and phones as plain WebSocket clients, takes uploaded over HTTP.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import test from 'node:test';
import type { HostView, PlayerView, ServerMessage } from '@doblaje/party';
import { mockOpenRouter, startApp, type TestApp } from '@doblaje/testkit';
import { Client, wav } from './support/party.ts';

let app: TestApp;
let clipId: string;

test.before(async () => {
  app = await startApp();
  clipId = await app.ingestFixture('clip_voices.mp4', 'pro', { template: true });
  const put = await app.api('PUT', `/api/projects/${clipId}`, {
    speakers: {
      list: [
        { id: 'A', name: 'Ana', color: '#d97b66', muted: false, solo: false },
        { id: 'B', name: 'Beto', color: '#6fb3a6', muted: false, solo: false },
      ],
      segments: [],
    },
    cues: [
      { id: 'c1', start: 0.5, end: 2, text: 'Hola, ¿qué tal?', character: 'Ana', note: '' },
      { id: 'c2', start: 2.5, end: 4, text: 'Muy bien', character: 'Beto', note: '' },
      { id: 'c3', start: 4.5, end: 6, text: 'Me alegro', character: 'Ana', note: '' },
    ],
  });
  assert.equal(put.status, 200);
});
test.after(async () => {
  await app.close();
});

test('a whole round: TV + two phones, cast, record every line, compile into the project', async () => {
  const room = await app.api('POST', '/api/party/rooms');
  assert.equal(room.status, 201);
  const { code, hostKey, joinUrl } = room.data;
  assert.match(code, /^[A-Z2-9]{4}$/);
  assert.match(joinUrl, new RegExp(`/play/\\?room=${code}$`));
  const tv = new Client(app.base);
  await tv.open();
  tv.send({ type: 'hello-host', code, hostKey });
  const v0 = await tv.view<HostView>();
  assert.equal(v0.role, 'host');
  assert.equal(v0.room.phase, 'lobby');

  const phones = [new Client(app.base), new Client(app.base)];
  const tokens: Record<string, string> = {};
  for (const [i, ph] of phones.entries()) {
    await ph.open();
    ph.send({ type: 'hello-player', code, name: ['Pau', 'Leo'][i] });
    const w = await ph.next((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
    tokens[w.playerId] = w.token;
  }
  await tv.view<HostView>((v) => v.room.players.length === 2);
  tv.send({ type: 'host', command: { type: 'pick-clip', clipId } });
  const picked = await tv.view<HostView>((v) => !!v.room.clip);
  assert.deepEqual(
    picked.room.characters.map((c) => [c.name, c.lines]),
    [
      ['Ana', 2],
      ['Beto', 1],
    ],
  );
  tv.send({ type: 'host', command: { type: 'cast' } });
  const cast = await tv.view<HostView>((v) => v.room.phase === 'casting');
  assert.equal(cast.room.cast.length, 2);
  const projectId = cast.room.projectId;
  assert.ok(projectId);

  // each phone learns its part, and nothing of the script before its turn
  for (const ph of phones) {
    const pv = await ph.view<PlayerView>((v) => v.phase === 'casting');
    assert.equal(pv.mine.length, 1);
    assert.equal(pv.line, null);
  }
  const pid = Object.keys(tokens)[0];
  const asPlayer = await app.api('GET', `/api/party/rooms/${code}/project`, undefined, { 'x-party-token': tokens[pid] });
  assert.equal(asPlayer.status, 200, 'a cast phone loads the round project');
  assert.equal((await app.api('GET', `/api/party/rooms/${code}/project`, undefined, { 'x-party-token': 'nope' })).status, 403);
  const media = await fetch(`${app.base}/party/${code}/media/proxy.mp4?t=${tokens[pid]}`);
  assert.equal(media.status, 200, 'a phone can stream the scene');
  await media.body?.cancel();
  assert.equal((await fetch(`${app.base}/party/${code}/media/source.mp4?t=${tokens[pid]}`)).status, 404, 'but not other files');
  tv.send({ type: 'host', command: { type: 'begin' } });
  let v = await tv.view<HostView>((x) => x.room.phase === 'playing');
  let recordedLines = 0;
  while (v.room.phase === 'playing') {
    const turn = v.room.turn;
    assert.ok(turn);
    const line = v.room.lines.find((l) => l.cueId === turn.cueId);
    assert.ok(line);
    const other = Object.keys(tokens).find((id) => id !== turn.playerId) as string;
    const wrong = await app.api('POST', `/api/party/rooms/${code}/takes?turn=${turn.n}&start=${line.start}`, wav(), { 'x-party-token': tokens[other] });
    assert.equal(wrong.status, 409, 'only the called player may submit');
    const r = await app.api('POST', `/api/party/rooms/${code}/takes?turn=${turn.n}&start=${line.start + 0.02}`, wav(1.2), {
      'x-party-token': tokens[turn.playerId],
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.ok(Math.abs(r.data.duration - 1.2) < 0.01);
    assert.ok(fs.existsSync(path.join(app.dir(projectId), 'takes', r.data.file)));
    recordedLines++;
    v = await tv.view<HostView>((x) => x.room.turn?.n !== turn.n);
  }
  assert.equal(recordedLines, 3);
  const shown = v.room.phase === 'show' ? v : await tv.view<HostView>((x) => x.room.phase === 'show');
  assert.equal(shown.room.results.length, 3);

  const p = (await app.api('GET', `/api/projects/${projectId}`)).data;
  assert.equal(p.mode, 'party');
  assert.equal(p.sourceTemplateId, clipId);
  assert.equal(p.tracks.length, 2);
  assert.deepEqual(p.tracks.map((t: { clips: unknown[] }) => t.clips.length).sort(), [1, 2]);
  assert.equal(p.dubbed.length, 3);

  tv.send({ type: 'host', command: { type: 'again' } });
  await tv.view<HostView>((x) => x.room.phase === 'lobby' && x.room.clip?.id === clipId);
  for (const c of [tv, ...phones]) c.close();
});

test('a phone that reconnects with its token is the same player; a wrong host key is refused', async () => {
  const { code, hostKey } = (await app.api('POST', '/api/party/rooms')).data;
  const a = new Client(app.base);
  await a.open();
  a.send({ type: 'hello-player', code, name: 'Mar' });
  const w = await a.next((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
  a.close();
  const b = new Client(app.base);
  await b.open();
  b.send({ type: 'hello-player', code, token: w.token });
  const w2 = await b.next((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
  assert.equal(w2.playerId, w.playerId);
  const pv = await b.view<PlayerView>((v) => v.me?.connected === true);
  assert.equal(pv.players.length, 1, 'no duplicate player');

  const nameless = new Client(app.base);
  await nameless.open();
  nameless.send({ type: 'hello-player', code });
  const e = await nameless.next((m): m is Extract<ServerMessage, { type: 'error' }> => m.type === 'error');
  assert.equal(e.code, 'bad-token');

  const fake = new Client(app.base);
  await fake.open();
  fake.send({ type: 'hello-host', code, hostKey: `${hostKey}x` });
  assert.equal((await fake.next((m): m is Extract<ServerMessage, { type: 'error' }> => m.type === 'error')).code, 'not-allowed');
  fake.send({ type: 'host', command: { type: 'cast' } });
  await fake.next((m): m is Extract<ServerMessage, { type: 'error' }> => m.type === 'error' && /Join a room/.test(m.message));
  for (const c of [b, nameless, fake]) c.close();
});

test('the Wi-Fi listener: HTTPS with a certificate for this machine, phone routes only', async () => {
  const lanApp = await startApp({ party: { port: 0, host: '127.0.0.1' } });
  try {
    const lan = lanApp.app.lan;
    assert.ok(lan, 'listening');
    const port = (lan.address() as { port: number }).port;
    const saved = JSON.parse(fs.readFileSync(path.join(lanApp.dataDir, 'tls', 'party-tls.json'), 'utf8'));
    assert.ok(saved.names.includes('127.0.0.1'));
    const get = (p: string, method = 'GET') =>
      new Promise<number>((resolve, reject) => {
        const req = https.request({ host: '127.0.0.1', port, path: p, method, ca: saved.cert }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        req.end();
      });
    assert.equal(await get('/'), 302, 'the root sends phones to /play/');
    assert.equal(await get('/api/projects'), 404, 'no studio API on the Wi-Fi');
    assert.equal(await get('/api/party/rooms', 'POST'), 201, 'a phone can open a room (no TV needed), limited per address');
    assert.equal(await get('/api/system'), 404);
    assert.equal(await get('/media/x/proxy.mp4'), 404, 'no project media outside a room');
    assert.equal(await get('/sounds/s0123456789.m4a'), 403, 'background sounds need a room token');
    const info = (await lanApp.api('GET', '/api/party/info')).data;
    assert.equal(info.joinBase, `https://${info.addresses[0] ?? 'localhost'}:${port}`);
  } finally {
    await lanApp.close();
  }
});

test('suggested lines: asked per turn, riff on what the previous player said, refusals are dropped', async () => {
  let refuse = false;
  const up = await mockOpenRouter((b) => ({
    json: {
      model: 'mock/cheap',
      choices: [{ message: { content: refuse ? "I'm sorry, I can't help with that." : `Ana: "¡Mi pato tiene hambre!"` } }],
      usage: { cost: 0.00001, total_tokens: 50 },
      _echo: b.messages.at(-1).content,
    },
  }));
  const ai = await startApp({ ai: { openrouterBase: up.url } });
  try {
    const clip = await ai.ingestFixture('clip_voices.mp4', 'pro', { template: true });
    await ai.api('PUT', `/api/projects/${clip}`, {
      speakers: {
        list: [
          { id: 'A', name: 'Ana', color: '#d97b66', muted: false, solo: false },
          { id: 'B', name: 'Beto', color: '#6fb3a6', muted: false, solo: false },
        ],
        segments: [],
      },
      cues: [
        { id: 'c1', start: 0.5, end: 2, text: 'Hola, ¿qué tal?', character: 'Ana', note: '' },
        { id: 'c2', start: 2.5, end: 4, text: 'Muy bien', character: 'Beto', note: '' },
      ],
    });
    const { code, hostKey } = (await ai.api('POST', '/api/party/rooms')).data;
    const tv = new Client(ai.base);
    await tv.open();
    tv.send({ type: 'hello-host', code, hostKey });
    const phones = [new Client(ai.base), new Client(ai.base)];
    const tokens: Record<string, string> = {};
    const byId: Record<string, Client> = {};
    for (const [i, ph] of phones.entries()) {
      await ph.open();
      ph.send({ type: 'hello-player', code, name: ['Pau', 'Leo'][i] });
      const w = await ph.next((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
      tokens[w.playerId] = w.token;
      byId[w.playerId] = ph;
    }
    // 'auto' is not a language anyone speaks: ignored; Spanish sticks
    tv.send({ type: 'host', command: { type: 'settings', settings: { maxCast: 2, order: 'scene', language: 'auto' as never } } });
    tv.send({ type: 'host', command: { type: 'settings', settings: { language: 'es' } } });
    tv.send({ type: 'host', command: { type: 'pick-clip', clipId: clip } });
    await tv.view<HostView>((v) => !!v.room.clip && v.room.settings.maxCast === 2 && v.room.settings.language === 'es');
    tv.send({ type: 'host', command: { type: 'cast' } });
    await tv.view<HostView>((v) => v.room.phase === 'casting');
    tv.send({ type: 'host', command: { type: 'begin' } });

    // turn 1 (Ana, c1): a suggestion arrives on that phone only
    const t1 = (await tv.view<HostView>((v) => v.room.turn?.cueId === 'c1')).room.turn;
    assert.ok(t1);
    const v1 = await byId[t1.playerId].view<PlayerView>((v) => !!v.line?.suggestion);
    assert.equal(v1.line?.suggestion, '¡Mi pato tiene hambre!', 'quotes and the speaker label are stripped');
    assert.match(up.reqs.at(-1)?.body.messages.at(-1).content, /language: Spanish/, 'asked in the language the players speak');
    const first = up.reqs[0].body;
    assert.match(first.messages[0].content, /never refuse/i, 'the system prompt tolerates crude players');
    assert.ok(first.max_tokens <= 80, 'one short line: cheap');

    // Ana's take goes in; the TV reports what was actually said; Beto's suggestion is asked again with it
    const r = await ai.api('POST', `/api/party/rooms/${code}/takes?turn=${t1.n}&start=0.5`, wav(1), { 'x-party-token': tokens[t1.playerId] });
    assert.equal(r.status, 201);
    const t2 = (await tv.view<HostView>((v) => v.room.turn?.cueId === 'c2')).room.turn;
    assert.ok(t2);
    refuse = true; // the riff request gets a refusal: no new suggestion, nothing breaks
    tv.send({ type: 'host', command: { type: 'heard', cueId: 'c1', text: 'tu madre es un pato' } });
    await tv.view<HostView>((v) => v.room.heard.c1 === 'tu madre es un pato');
    for (let i = 0; i < 50 && !up.reqs.some((q) => q.body.messages.at(-1).content.includes('tu madre es un pato')); i++)
      await new Promise((res) => setTimeout(res, 100));
    const riff = up.reqs.find((q) => q.body.messages.at(-1).content.includes('tu madre es un pato'));
    assert.ok(riff, 'the next suggestion is asked with what the player actually said');
    assert.match(riff.body.messages.at(-1).content, /Now Beto speaks/);
    const v2 = await byId[t2.playerId].view<PlayerView>((v) => v.line?.cueId === 'c2' && !!v.context.before?.heard);
    assert.equal(v2.context.before?.heard, 'tu madre es un pato', 'the next player sees the actual take text');
    tv.send({ type: 'host', command: { type: 'finish' } });
    await tv.view<HostView>((v) => v.room.phase === 'show');
    for (const c of [tv, ...phones]) c.close();
  } finally {
    await ai.close();
    await up.close();
  }
});

test('suggestion text: cleaned, refusals and essays rejected', async () => {
  const { cleanSuggestion, suggestionPrompt } = await import('@doblaje/ai');
  assert.equal(cleanSuggestion('"¡Hola, patata!"'), '¡Hola, patata!');
  assert.equal(cleanSuggestion('Beto: Qué dices, loco'), 'Qué dices, loco');
  assert.equal(cleanSuggestion("I'm sorry, but I can't write that."), null);
  assert.equal(cleanSuggestion('Lo siento, no puedo ayudar con eso.'), null);
  assert.equal(cleanSuggestion(Array(40).fill('palabra').join(' ')), null);
  const p = suggestionPrompt({
    scene: 'Escena',
    character: 'Beto',
    original: 'Muy bien',
    seconds: 1.5,
    previous: { character: 'Ana', original: 'Hola', said: 'tu madre es un pato' },
  });
  assert.match(p, /tu madre es un pato/);
  assert.match(p, /improvised by a player/);
  // the players speak Spanish over an English scene: the line is asked in Spanish, its length from the English
  const es = suggestionPrompt({ scene: 'Scene', character: 'Bob', original: 'Good morning to you', seconds: 1.5, language: 'es' });
  assert.match(es, /language: Spanish/);
  assert.match(es, /about 5 syllables/);
});

/** a room with a TV and `n` phones, a clip picked; returns helpers */
async function roomWith(n: number, settings: Record<string, unknown> = {}) {
  const { code, hostKey } = (await app.api('POST', '/api/party/rooms')).data;
  const tv = new Client(app.base);
  await tv.open();
  tv.send({ type: 'hello-host', code, hostKey });
  const tokens: Record<string, string> = {};
  const phones: Client[] = [];
  for (let i = 0; i < n; i++) {
    const ph = new Client(app.base);
    await ph.open();
    ph.send({ type: 'hello-player', code, name: `P${i}` });
    const w = await ph.next((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
    tokens[w.playerId] = w.token;
    phones.push(ph);
  }
  tv.send({ type: 'host', command: { type: 'settings', settings } });
  tv.send({ type: 'host', command: { type: 'pick-clip', clipId } });
  await tv.view<HostView>((v) => !!v.room.clip);
  return {
    code,
    tv,
    phones,
    tokens,
    close: () => {
      for (const c of [tv, ...phones]) c.close();
    },
  };
}

test('bad lip reading: the round waits for its script (offline writer here), players read the new lines, the result shows them', async () => {
  const r = await roomWith(2, { mode: 'badlip', premise: 'a very lazy cat', maxCast: 2 });
  r.tv.send({ type: 'host', command: { type: 'cast' } });
  const cast = await r.tv.view<HostView>((v) => v.room.phase === 'casting');
  const written = await r.tv.view<HostView>((v) => v.room.phase === 'casting' && !v.room.preparing);
  const queued = written.room.queue.map((id) => written.room.lines.find((l) => l.cueId === id));
  const original = written.room.source.lines;
  assert.ok(
    queued.some((l) => l && l.text !== original.find((o) => o.cueId === l.cueId)?.text),
    'the lines were rewritten',
  );
  void cast;
  r.tv.send({ type: 'host', command: { type: 'begin' } });
  const v = await r.tv.view<HostView>((x) => x.room.phase === 'playing');
  const turn = v.room.turn;
  assert.ok(turn);
  const line = v.room.lines.find((l) => l.cueId === turn.cueId);
  assert.ok(line);
  const up = await app.api('POST', `/api/party/rooms/${r.code}/takes?turn=${turn.n}&start=${line.start}`, wav(1), { 'x-party-token': r.tokens[turn.playerId] });
  assert.equal(up.status, 201);
  r.tv.send({ type: 'host', command: { type: 'finish' } });
  const shown = await r.tv.view<HostView>((x) => x.room.phase === 'show');
  const p = (await app.api('GET', `/api/projects/${shown.room.projectId}`)).data;
  assert.equal(p.cues.find((c: { id: string }) => c.id === line.cueId)?.text, line.text, 'the written line is the subtitle of the result');
  assert.equal(p.party.mode, 'badlip');
  r.close();
});

test('blind dubbing: segments, and the next phone can fetch the previous take (and only that room’s files)', async () => {
  const r = await roomWith(2, { mode: 'blind', maxCast: 2, maxLines: 4 });
  r.tv.send({ type: 'host', command: { type: 'cast' } });
  const cast = await r.tv.view<HostView>((v) => v.room.phase === 'casting');
  assert.equal(cast.room.preparing, false);
  assert.ok(cast.room.lines.every((l) => l.text === ''));
  r.tv.send({ type: 'host', command: { type: 'begin' } });
  const v1 = await r.tv.view<HostView>((x) => x.room.phase === 'playing');
  const t1 = v1.room.turn;
  assert.ok(t1);
  const seg = v1.room.lines.find((l) => l.cueId === t1.cueId);
  assert.ok(seg);
  const up = await app.api('POST', `/api/party/rooms/${r.code}/takes?turn=${t1.n}&start=${seg.start}`, wav(2), { 'x-party-token': r.tokens[t1.playerId] });
  assert.equal(up.status, 201);
  const v2 = await r.tv.view<HostView>((x) => x.room.turn?.n === t1.n + 1);
  const t2 = v2.room.turn;
  assert.ok(t2);
  const next = r.phones[Object.keys(r.tokens).indexOf(t2.playerId)];
  const pv = await next.view<PlayerView>((x) => x.turn?.n === t2.n && !!x.context.before?.take);
  assert.equal(pv.context.before?.take, up.data.file);
  const got = await fetch(`${app.base}/party/${r.code}/media/takes/${up.data.file}?t=${r.tokens[t2.playerId]}`);
  assert.equal(got.status, 200, 'the previous take can be fetched by the room');
  await got.body?.cancel();
  r.close();
});
