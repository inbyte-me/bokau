// Accounts for hosts: signing in, rooms that belong to their opener, and a library whose clips are private to their owner.
// The identity provider is replaced by the dev stand-in (`AUTH_PROVIDER=dev`): no network.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlayerView, ServerMessage } from '@doblaje/party';
import { startApp, type TestApp } from '@doblaje/testkit';
import { Client } from './support/party.ts';

let app: TestApp;
let starter: string;
let pauClip: string;
let leoClip: string;

const welcome = (m: ServerMessage): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome';
const errorMsg = (m: ServerMessage): m is Extract<ServerMessage, { type: 'error' }> => m.type === 'error';
const script = {
  speakers: { list: [{ id: 'A', name: 'Ana', color: '#d97b66', muted: false, solo: false }], segments: [] },
  cues: [{ id: 'c1', start: 0.5, end: 2, text: 'Hola, ¿qué tal?', character: 'Ana', note: '' }],
};

/** sign in as `name` (the dev stand-in): the session cookie to send back */
async function signIn(name: string): Promise<string> {
  const r = await fetch(`${app.base}/auth/callback?code=${encodeURIComponent(name)}&state=/play/`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  const cookie = r.headers.get('set-cookie') ?? '';
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  return cookie.split(';')[0];
}
const create = (cookie?: string) => app.api('POST', '/api/party/rooms', undefined, cookie ? { cookie } : {});

test.before(async () => {
  app = await startApp({ mode: 'party', auth: { provider: 'dev' } });
  // three prepared clips in the library (made in the studio, here on the same data folder)
  const studio = await startApp({ dataDir: app.dataDir });
  try {
    for (const name of ['starter', 'pau', 'leo']) {
      const id = await studio.ingestFixture('clip_voices.mp4', 'pro', { template: true });
      assert.equal((await studio.api('PUT', `/api/projects/${id}`, { name, ...script })).status, 200);
      if (name === 'starter') starter = id;
      if (name === 'pau') pauClip = id;
      if (name === 'leo') leoClip = id;
    }
  } finally {
    await studio.app.close(); // (its data folder is ours: not removed)
  }
  app.app.ctx.users.claim(pauClip, 'dev_pau');
  app.app.ctx.users.claim(leoClip, 'dev_leo');
});
test.after(async () => {
  await app.close();
});

test('hosting needs a sign-in; a guest needs none', async () => {
  const anon = await create();
  assert.equal(anon.status, 401);
  assert.equal(anon.data.code, 'login');
  assert.equal((await app.api('GET', '/api/me')).data.person, null);
  assert.equal((await app.api('GET', '/api/me')).data.loginRequired, true);

  const pau = await signIn('Pau');
  const me = (await app.api('GET', '/api/me', undefined, { cookie: pau })).data;
  assert.deepEqual(me.person, { id: 'dev_pau', name: 'Pau' });
  assert.equal(app.app.ctx.users.get('dev_pau')?.name, 'Pau', 'remembered');
  const room = await create(pau);
  assert.equal(room.status, 201);

  // a guest joins the host's room with no account at all
  const guest = new Client(app.base);
  await guest.open();
  guest.send({ type: 'hello-player', code: room.data.code, name: 'Friend' });
  assert.ok((await guest.next(welcome)).token);
  guest.close();
});

test('sign-in only returns to a page of this site (no open redirect), and signing out forgets the session', async () => {
  const evil = await fetch(`${app.base}/auth/callback?code=Pau&state=${encodeURIComponent('https://evil.example.com/')}`, { redirect: 'manual' });
  assert.equal(evil.headers.get('location'), '/play/');
  const protocolRelative = await fetch(`${app.base}/auth/callback?code=Pau&state=${encodeURIComponent('//evil.example.com')}`, { redirect: 'manual' });
  assert.equal(protocolRelative.headers.get('location'), '/play/');
  const out = await fetch(`${app.base}/auth/logout`, { redirect: 'manual' });
  assert.equal(out.status, 302);
  assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/);
});

test('a host’s library is theirs: their own clips and the starter pack, nobody else’s', async () => {
  const pau = await signIn('Pau');
  const leo = await signIn('Leo');
  const room = (await create(pau)).data;
  const host = new Client(app.base);
  await host.open();
  host.send({ type: 'hello-player', code: room.code, name: 'Pau', hostKey: room.hostKey });
  const token = (await host.next(welcome)).token;

  const list = (await app.api('GET', `/api/party/rooms/${room.code}/clips`, undefined, { 'x-party-token': token })).data as { id: string }[];
  assert.deepEqual(list.map((c) => c.id).sort(), [starter, pauClip].sort(), 'the starter pack and their own clip, not Leo’s');

  // Leo’s clip cannot be played in Pau’s room, even by asking for it by id
  host.send({ type: 'host', command: { type: 'pick-clip', clipId: leoClip } });
  assert.match((await host.next(errorMsg)).message, /not in your library/);
  assert.equal((await fetch(`${app.base}/party/${room.code}/clips/${leoClip}/poster.jpg?t=${token}`)).status, 404, 'nor its poster');
  host.send({ type: 'host', command: { type: 'pick-clip', clipId: pauClip } });
  await host.view<PlayerView>((v) => v.board.clip?.id === pauClip);
  host.close();

  // and the other way round: Leo sees his own
  const leoRoom = (await create(leo)).data;
  const leoHost = new Client(app.base);
  await leoHost.open();
  leoHost.send({ type: 'hello-player', code: leoRoom.code, name: 'Leo', hostKey: leoRoom.hostKey });
  const leoToken = (await leoHost.next(welcome)).token;
  const leoList = (await app.api('GET', `/api/party/rooms/${leoRoom.code}/clips`, undefined, { 'x-party-token': leoToken })).data as { id: string }[];
  assert.deepEqual(leoList.map((c) => c.id).sort(), [starter, leoClip].sort());
  leoHost.close();
});

test('with accounts off (a laptop), rooms are anonymous and nothing changes', async () => {
  const open = await startApp();
  try {
    assert.equal((await open.api('POST', '/api/party/rooms')).status, 201);
    assert.equal((await open.api('GET', '/api/me')).data.loginRequired, false);
  } finally {
    await open.close();
  }
});

test('a session cookie is Secure when the server is reached over HTTPS', async () => {
  const https = await startApp({ mode: 'party', auth: { provider: 'dev' }, party: { publicUrl: 'https://party.example.com' } });
  try {
    const r = await fetch(`${https.base}/auth/callback?code=Pau`, { redirect: 'manual' });
    assert.match(r.headers.get('set-cookie') ?? '', /; Secure/);
  } finally {
    await https.close();
  }
});
