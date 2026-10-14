// Rooms without a TV: a phone creates the room, hosts it and plays; a screen only watches; the server renders the result.
// And the server mode meant for a domain: only the phones' routes, limits per address, CORS for configured origins.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlayerView, ScreenView, ServerMessage } from '@doblaje/party';
import { ffprobeJson, startApp, type TestApp } from '@doblaje/testkit';
import { Client, wav } from './support/party.ts';

let app: TestApp;
let clipId: string;

test.before(async () => {
  app = await startApp();
  clipId = await app.ingestFixture('clip_voices.mp4', 'pro', { template: true });
  await app.api('PUT', `/api/projects/${clipId}`, {
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
});
test.after(async () => {
  await app.close();
});

const welcome = (m: ServerMessage): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome';
const errorMsg = (m: ServerMessage): m is Extract<ServerMessage, { type: 'error' }> => m.type === 'error';

test('a phone creates the room and hosts it while playing; another phone cannot; a screen only watches', async () => {
  const { code, hostKey } = (await app.api('POST', '/api/party/rooms')).data;
  const host = new Client(app.base);
  const guest = new Client(app.base);
  const screen = new Client(app.base);
  for (const c of [host, guest, screen]) await c.open();
  host.send({ type: 'hello-player', code, name: 'Pau', hostKey });
  guest.send({ type: 'hello-player', code, name: 'Leo' });
  screen.send({ type: 'hello-screen', code });
  const w = await host.next(welcome);
  await guest.next(welcome);

  const hv = await host.view<PlayerView>((v) => v.players.length === 2);
  assert.equal(hv.isHost, true, 'the phone that showed the host key is the host');
  assert.equal((await guest.view<PlayerView>((v) => v.players.length === 2)).isHost, false);
  assert.equal(hv.me?.name, 'Pau', 'and a player');
  const sv = (await screen.view<ScreenView>((v) => v.role === 'screen')) as ScreenView;
  assert.equal(sv.board.players.length, 2, 'a screen sees the public board');
  assert.match(sv.joinUrl, new RegExp(`/play/\\?room=${code}$`));

  // host commands: the host phone may, the guest may not
  guest.send({ type: 'host', command: { type: 'pick-clip', clipId } });
  assert.match((await guest.next(errorMsg)).message, /Only the host/);
  host.send({ type: 'host', command: { type: 'pick-clip', clipId } });
  await host.view<PlayerView>((v) => v.board.clip?.id === clipId);
  host.send({ type: 'host', command: { type: 'settings', settings: { mode: 'trailer' } } });
  host.send({ type: 'host', command: { type: 'cast' } });
  const cards = await host.view<PlayerView>((v) => v.board.phase === 'cards');
  assert.equal(cards.board.contests.filter((c) => c.kind === 'card').length, 2);

  // the board never carries what a player must not see: cards stay off until the cast is revealed
  const board = (await screen.view<ScreenView>((v) => v.board.phase === 'cards')).board;
  assert.deepEqual(board.cast, [], 'who plays whom is hidden while characters are described');
  assert.ok(
    board.contests.every((c) => c.entries === null && c.text === null),
    'the words of a card are not on the board',
  );
  for (const c of cards.board.contests) {
    const writer = c.writers[0].playerId;
    const phone = writer === w.playerId ? host : guest;
    phone.send({ type: 'player', action: { type: 'submit', task: c.id, text: 'Gruff and slow' } });
  }
  const casting = (await screen.view<ScreenView>((v) => v.board.phase === 'casting')).board;
  assert.ok(
    casting.characters.every((c) => c.card === 'Gruff and slow'),
    'revealed with the cast',
  );
  assert.equal(casting.cast.length, 2);
  for (const c of [host, guest, screen]) c.close();
});

test('the host’s routes: the clip list and the poster need the host key (or a token that showed it)', async () => {
  const { code, hostKey } = (await app.api('POST', '/api/party/rooms')).data;
  const host = new Client(app.base);
  const guest = new Client(app.base);
  await host.open();
  await guest.open();
  host.send({ type: 'hello-player', code, name: 'Pau', hostKey });
  guest.send({ type: 'hello-player', code, name: 'Leo' });
  const hostToken = (await host.next(welcome)).token;
  const guestToken = (await guest.next(welcome)).token;
  const list = (await app.api('GET', `/api/party/rooms/${code}/clips`, undefined, { 'x-party-token': hostToken })).data;
  assert.deepEqual(
    list.map((c: { id: string; characters: string[] }) => [c.id, c.characters]),
    [[clipId, ['Ana', 'Beto']]],
  );
  assert.equal((await app.api('GET', `/api/party/rooms/${code}/clips`, undefined, { 'x-party-host': hostKey })).status, 200, 'the key alone works too (a TV)');
  assert.equal((await app.api('GET', `/api/party/rooms/${code}/clips`, undefined, { 'x-party-token': guestToken })).status, 403, 'a guest cannot');
  assert.equal((await app.api('GET', `/api/party/rooms/${code}/clips`)).status, 403);
  const poster = await fetch(`${app.base}/party/${code}/clips/${clipId}/poster.jpg?t=${guestToken}`);
  assert.equal(poster.status, 200, 'any player may see a clip’s poster');
  await poster.body?.cancel();
  assert.equal((await fetch(`${app.base}/party/${code}/clips/${clipId}/poster.jpg`)).status, 403, 'but not without a token');
  host.close();
  guest.close();
});

test('the host phone renders the finished round’s mix; the server makes one result file everyone plays together', async () => {
  const { code, hostKey } = (await app.api('POST', '/api/party/rooms')).data;
  const host = new Client(app.base);
  const guest = new Client(app.base);
  await host.open();
  await guest.open();
  host.send({ type: 'hello-player', code, name: 'Pau', hostKey, worker: true });
  guest.send({ type: 'hello-player', code, name: 'Leo' });
  const w = await host.next(welcome);
  const g = await guest.next(welcome);
  const tokens: Record<string, string> = { [w.playerId]: w.token, [g.playerId]: g.token };
  host.send({ type: 'host', command: { type: 'pick-clip', clipId } });
  host.send({ type: 'host', command: { type: 'settings', settings: { mode: 'dub', maxCast: 2 } } });
  await host.view<PlayerView>((v) => v.board.clip?.id === clipId && v.board.settings.mode === 'dub');
  host.send({ type: 'host', command: { type: 'cast' } });
  const cast = await host.view<PlayerView>((v) => v.board.phase === 'casting');
  const projectId = cast.board.projectId;
  assert.ok(projectId);
  host.send({ type: 'host', command: { type: 'begin' } });
  let v = await host.view<PlayerView>((x) => x.board.phase === 'playing');
  // the host answers the render job: render (here: a tone as long as the clip) and upload
  let job: Extract<ServerMessage, { type: 'job' }> | null = null;
  host.ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data)) as ServerMessage;
    if (m.type === 'job') job = m;
  });
  while (v.board.phase === 'playing') {
    const turn = v.board.turn;
    assert.ok(turn);
    const full = (await app.api('GET', `/api/party/rooms/${code}/project`, undefined, { 'x-party-token': tokens[turn.playerId] })).data;
    assert.equal(full.id, projectId);
    const up = await app.api('POST', `/api/party/rooms/${code}/takes?turn=${turn.n}&start=0.5`, wav(1.2), { 'x-party-token': tokens[turn.playerId] });
    assert.equal(up.status, 201);
    v = await host.view<PlayerView>((x) => x.board.turn?.n !== turn.n);
  }
  for (let i = 0; i < 100 && !job; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal((job as { projectId?: string } | null)?.projectId, projectId, 'the host is asked to render');
  const mix = await app.api('POST', `/api/party/rooms/${code}/mix`, wav(6.5), { 'x-party-token': tokens[w.playerId] });
  assert.equal(mix.status, 201, JSON.stringify(mix.data));
  const shown = await guest.view<PlayerView>((x) => x.board.phase === 'show');
  assert.equal(shown.board.result?.file, 'result.mp4');
  assert.ok((shown.board.result?.startAt ?? 0) > Date.now() - 1000, 'a start time in the near future, the same for everyone');
  const file = await fetch(`${app.base}/party/${code}/media/result.mp4?t=${tokens[g.playerId]}`);
  assert.equal(file.status, 200, 'any player can fetch the result');
  const bytes = Buffer.from(await file.arrayBuffer());
  assert.ok(bytes.length > 5000);
  const probe = ffprobeJson(`${app.dir(projectId)}/result.mp4`);
  assert.ok(probe.streams.some((s) => s.codec_type === 'video') && probe.streams.some((s) => s.codec_type === 'audio'));
  // nobody else may send a mix
  assert.equal((await app.api('POST', `/api/party/rooms/${code}/mix`, wav(1), { 'x-party-token': tokens[g.playerId] })).status, 403);
  host.close();
  guest.close();
});

test('the server listens to takes itself when it can (so a room needs no TV for it)', async () => {
  const heard = await startApp({ party: { transcribe: false } });
  try {
    assert.equal((await heard.api('GET', '/api/party/info')).data.transcribes, false);
  } finally {
    await heard.close();
  }
});

test('party server mode: only the phones’ routes, a health check, limits per address, CORS for configured origins', async () => {
  const srv = await startApp({ mode: 'party', party: { createsPerHour: 2, trustProxy: 1, origins: ['https://play.example.com'] } });
  try {
    const call = (method: string, url: string, headers: Record<string, string> = {}) => srv.api(method, url, undefined, headers);
    assert.equal((await call('GET', '/healthz')).data.mode, 'party');
    assert.equal((await call('GET', '/api/projects')).status, 404, 'no studio API');
    assert.equal((await call('GET', '/api/system')).status, 404);
    assert.equal((await call('GET', '/media/x/proxy.mp4')).status, 404);
    assert.equal((await call('GET', '/api/party/info')).data.mode, 'party');
    // two rooms per address per hour; the address is the one the proxy saw
    assert.equal((await call('POST', '/api/party/rooms', { 'x-forwarded-for': '203.0.113.7' })).status, 201);
    assert.equal((await call('POST', '/api/party/rooms', { 'x-forwarded-for': '203.0.113.7' })).status, 201);
    assert.equal((await call('POST', '/api/party/rooms', { 'x-forwarded-for': '203.0.113.7' })).status, 429);
    assert.equal((await call('POST', '/api/party/rooms', { 'x-forwarded-for': '198.51.100.9' })).status, 201, 'another address is not limited');
    // pages of other origins: only the configured ones
    const pre = await fetch(`${srv.base}/api/party/rooms`, {
      method: 'OPTIONS',
      headers: { origin: 'https://play.example.com', 'access-control-request-method': 'POST' },
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://play.example.com');
    const bad = await call('POST', '/api/party/rooms', { origin: 'https://evil.example.com', 'x-forwarded-for': '198.51.100.10' });
    assert.equal(bad.status, 403, 'an unknown origin cannot use it');
    const ok = await call('POST', '/api/party/rooms', { origin: 'https://play.example.com', 'x-forwarded-for': '198.51.100.11' });
    assert.equal(ok.status, 201);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://play.example.com');
    const root = await fetch(`${srv.base}/`, { redirect: 'manual' });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('x-content-type-options'), 'nosniff');
    assert.match(root.headers.get('permissions-policy') ?? '', /microphone=\(self\)/);
    // a socket from an unknown origin is refused
    const ws = new WebSocket(`${srv.base.replace(/^http/, 'ws')}/party/ws`, { headers: { origin: 'https://evil.example.com' } } as never);
    const closed = await new Promise<string>((resolve) => {
      ws.addEventListener('error', () => resolve('error'));
      ws.addEventListener('open', () => resolve('open'));
    });
    assert.equal(closed, 'error');
  } finally {
    await srv.close();
  }
});

test('party server: when everyone has left, the room and the media made for it are deleted, the library clip stays; the result downloads until then', async () => {
  // the same library, served by a party server that forgets empty rooms after a moment
  const srv = await startApp({ mode: 'party', dataDir: app.dataDir, party: { emptyRoomMinutes: 0.03 } });
  try {
    const { code, hostKey } = (await srv.api('POST', '/api/party/rooms')).data;
    const host = new Client(srv.base);
    await host.open();
    host.send({ type: 'hello-player', code, name: 'Pau', hostKey });
    const w = await host.next(welcome);
    host.send({ type: 'host', command: { type: 'pick-clip', clipId } });
    host.send({ type: 'host', command: { type: 'cast' } });
    const cast = await host.view<PlayerView>((v) => v.board.phase === 'casting');
    const projectId = cast.board.projectId;
    assert.ok(projectId);
    const fs = await import('node:fs');
    assert.ok(fs.existsSync(app.dir(projectId)), 'the round’s media exists while the room is open');
    // a download of the result asks the browser to save it under a name that says what it is
    fs.writeFileSync(`${app.dir(projectId)}/result.mp4`, Buffer.alloc(2000));
    const dl = await fetch(`${srv.base}/party/${code}/media/result.mp4?t=${w.token}&download=1`);
    assert.match(dl.headers.get('content-disposition') ?? '', new RegExp(`attachment; filename=".+_${code}\\.mp4"`));
    await dl.body?.cancel();

    host.close();
    for (let i = 0; i < 80 && srv.app.ctx.party.size > 0; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(srv.app.ctx.party.size, 0, 'the room is gone');
    assert.ok(!fs.existsSync(app.dir(projectId)), 'and so is every file made for it');
    assert.ok(fs.existsSync(app.dir(clipId)), 'the library clip is untouched');
    assert.equal((await app.api('GET', `/api/projects/${clipId}`)).data.media.ready, true);
    const again = new Client(srv.base);
    await again.open();
    again.send({ type: 'hello-player', code, name: 'Pau' });
    assert.equal((await again.next(errorMsg)).code, 'no-room');
    again.close();
  } finally {
    await srv.close();
  }
});

test('behind two proxies (Dokploy’s Traefik, then Caddy) the visitor is the address two hops from the end, and cannot be spoofed', async () => {
  const srv = await startApp({ mode: 'party', party: { createsPerHour: 1, trustProxy: 2 } });
  try {
    const open = (xff: string) => srv.api('POST', '/api/party/rooms', undefined, { 'x-forwarded-for': xff });
    // Traefik saw the visitor (203.0.113.7) and Caddy appended Traefik's address: "visitor, traefik"
    assert.equal((await open('203.0.113.7, 172.18.0.3')).status, 201);
    assert.equal((await open('203.0.113.7, 172.18.0.3')).status, 429, 'the same visitor is limited');
    assert.equal((await open('198.51.100.9, 172.18.0.3')).status, 201, 'another visitor behind the same proxy is not');
    // a visitor who sends their own X-Forwarded-For only adds to the front: the address two hops from the end is still theirs
    assert.equal((await open('1.2.3.4, 203.0.113.7, 172.18.0.3')).status, 429, 'a spoofed first entry changes nothing');
  } finally {
    await srv.close();
  }
});
