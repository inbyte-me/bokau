// Accounts for hosts: signing in, a studio of their own for each person, and a library nobody else can reach.
// The identity provider is replaced by the dev stand-in (`AUTH_PROVIDER=dev`): no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import type { PlayerView, ServerMessage } from '@doblaje/party';
import { fx, mockOpenRouter, startApp, type TestApp } from '@doblaje/testkit';
import { Client } from './support/party.ts';

let app: TestApp;
const welcome = (m: ServerMessage): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome';
const errorMsg = (m: ServerMessage): m is Extract<ServerMessage, { type: 'error' }> => m.type === 'error';
const script = {
  speakers: { list: [{ id: 'A', name: 'Ana', color: '#d97b66', muted: false, solo: false }], segments: [] },
  cues: [{ id: 'c1', start: 0.5, end: 2, text: 'Hola, ¿qué tal?', character: 'Ana', note: '' }],
};

/** sign in as `name` (the dev stand-in): the session cookie to send back */
async function signIn(base: string, name: string): Promise<string> {
  const r = await fetch(`${base}/auth/callback?code=${encodeURIComponent(name)}&state=/play/`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  const cookie = r.headers.get('set-cookie') ?? '';
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  return cookie.split(';')[0];
}
/** a person builds a library clip in their own studio, through the studio's API: create, upload the video, wait, add characters */
async function buildClip(srv: TestApp, cookie: string, name: string): Promise<string> {
  const h = { cookie };
  const made = await srv.api('POST', '/api/projects', { name, mode: 'pro', template: true }, h);
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.id as string;
  const up = await srv.api('POST', `/api/projects/${id}/source`, fs.readFileSync(fx('clip_voices.mp4')), { ...h, 'x-filename': 'clip.mp4' });
  assert.equal(up.status, 202, JSON.stringify(up.data));
  for (let i = 0; i < 300; i++) {
    const j = (await srv.api('GET', `/api/jobs/${up.data.job}`, undefined, h)).data;
    if (j.status === 'done') break;
    assert.notEqual(j.status, 'error', j.error);
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal((await srv.api('PUT', `/api/projects/${id}`, { name, ...script }, h)).status, 200);
  return id;
}
const create = (cookie?: string) => app.api('POST', '/api/party/rooms', undefined, cookie ? { cookie } : {});

test.before(async () => {
  app = await startApp({ mode: 'party', auth: { provider: 'dev' } });
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

  const pau = await signIn(app.base, 'Pau');
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

test('the studio is for signed-in people only, and each person has a library of their own that nobody else can reach', async () => {
  // signed out: nothing of the studio answers
  assert.equal((await app.api('GET', '/api/projects')).status, 401);
  assert.equal((await app.api('POST', '/api/projects', { name: 'x', template: true })).status, 401);
  const gate = await fetch(`${app.base}/studio/`, { redirect: 'manual' });
  assert.equal(gate.status, 302);
  assert.match(gate.headers.get('location') ?? '', /^\/auth\/login\?return=%2Fstudio%2F$/);
  assert.equal((await fetch(`${app.base}/media/p0000000000/proxy.mp4`)).status, 401);
  assert.equal((await fetch(`${app.base}/hf/Xenova/whisper-base/resolve/main/config.json`)).status, 401, 'no open proxy to the model hub');

  const pau = await signIn(app.base, 'Pau');
  const leo = await signIn(app.base, 'Leo');
  const pauClip = await buildClip(app, pau, 'Pau’s heist');

  const pauList = (await app.api('GET', '/api/projects?kind=clips', undefined, { cookie: pau })).data as { id: string }[];
  assert.deepEqual(
    pauList.map((c) => c.id),
    [pauClip],
  );
  assert.deepEqual((await app.api('GET', '/api/projects?kind=clips', undefined, { cookie: leo })).data, [], 'Leo’s library is empty');
  // Leo cannot touch Pau's clip by its id: it does not exist in his studio
  assert.equal((await app.api('GET', `/api/projects/${pauClip}`, undefined, { cookie: leo })).status, 404);
  assert.equal((await app.api('PUT', `/api/projects/${pauClip}`, { name: 'mine now' }, { cookie: leo })).status, 404);
  await app.api('DELETE', `/api/projects/${pauClip}`, undefined, { cookie: leo }); // (deleting what is not in your library does nothing)
  assert.equal((await app.api('GET', `/api/projects/${pauClip}`, undefined, { cookie: pau })).data.name, 'Pau’s heist', 'Pau’s clip is untouched');
  assert.equal((await fetch(`${app.base}/media/${pauClip}/proxy.mp4`, { headers: { cookie: leo } })).status, 404);
  const own = await fetch(`${app.base}/media/${pauClip}/proxy.mp4`, { headers: { cookie: pau } });
  assert.equal(own.status, 200, 'and Pau sees his own picture');
  await own.body?.cancel();
  // the files live in a folder of his own on disk
  assert.ok(fs.existsSync(`${app.dataDir}/users/dev_pau/projects/${pauClip}/proxy.mp4`));
  assert.ok(!fs.existsSync(`${app.dataDir}/users/dev_leo/projects/${pauClip}`));
  // the laptop-only door stays shut
  assert.equal((await app.api('POST', '/api/projects/from-path', { path: fx('clip_voices.mp4') }, { cookie: pau })).status, 403);
});

test('a host’s rooms play from their own library only', async () => {
  const pau = await signIn(app.base, 'Pau');
  const leo = await signIn(app.base, 'Leo');
  const leoClip = await buildClip(app, leo, 'Leo’s clip');
  const pauClip = ((await app.api('GET', '/api/projects?kind=clips', undefined, { cookie: pau })).data as { id: string }[])[0].id;

  const room = (await create(pau)).data;
  const host = new Client(app.base);
  await host.open();
  host.send({ type: 'hello-player', code: room.code, name: 'Pau', hostKey: room.hostKey });
  const token = (await host.next(welcome)).token;
  const list = (await app.api('GET', `/api/party/rooms/${room.code}/clips`, undefined, { 'x-party-token': token })).data as { id: string }[];
  assert.deepEqual(
    list.map((c) => c.id),
    [pauClip],
    'his clip, not Leo’s',
  );
  host.send({ type: 'host', command: { type: 'pick-clip', clipId: leoClip } });
  assert.match((await host.next(errorMsg)).message, /no such project|not found/i, 'Leo’s clip does not exist for Pau’s room');
  assert.equal((await fetch(`${app.base}/party/${room.code}/clips/${leoClip}/poster.jpg?t=${token}`)).status, 404);
  const poster = await fetch(`${app.base}/party/${room.code}/clips/${pauClip}/poster.jpg?t=${token}`);
  assert.equal(poster.status, 200);
  await poster.body?.cancel();
  host.send({ type: 'host', command: { type: 'pick-clip', clipId: pauClip } });
  await host.view<PlayerView>((v) => v.board.clip?.id === pauClip);
  host.send({ type: 'host', command: { type: 'cast' } });
  const cast = await host.view<PlayerView>((v) => v.board.phase === 'casting');
  const round = cast.board.projectId;
  assert.ok(round);
  assert.ok(fs.existsSync(`${app.dataDir}/users/dev_pau/projects/${round}`), 'the round is made in his workspace');
  host.close();
});

test('limits: an upload larger than allowed, a full library and an AI budget of their own', async () => {
  const tight = await startApp({ mode: 'party', auth: { provider: 'dev' }, party: { userUploadBytes: 5000, userQuotaBytes: 200_000 } });
  try {
    const pau = await signIn(tight.base, 'Pau');
    const h = { cookie: pau };
    const made = await tight.api('POST', '/api/projects', { name: 'big', mode: 'pro', template: true }, h);
    // refused while it is still being sent: either the 413 arrives, or the server hangs up on the rest of the body
    const tooBig = await tight
      .api('POST', `/api/projects/${made.data.id}/source`, fs.readFileSync(fx('clip_voices.mp4')), { ...h, 'x-filename': 'clip.mp4' })
      .catch(() => null);
    assert.ok(tooBig === null || tooBig.status === 413, `larger than one upload may be: ${tooBig?.status}`);
    assert.ok(!fs.readdirSync(`${tight.dataDir}/users/dev_pau/projects/${made.data.id}`).some((f) => f.startsWith('source.')), 'nothing was kept');
    // fill the library past its quota: the next upload is refused before it starts
    fs.writeFileSync(`${tight.dataDir}/users/dev_pau/projects/${made.data.id}/filler.bin`, Buffer.alloc(300_000));
    await new Promise((r) => setTimeout(r, 0));
    const full = await tight.api('POST', '/api/projects', { name: 'more', mode: 'pro' }, h);
    assert.equal(full.status, 413);
    assert.match(JSON.stringify(full.data), /library is full/);
    assert.equal((await tight.api('GET', '/api/projects', undefined, h)).status, 200, 'reading and deleting still work');
    assert.equal((await tight.api('DELETE', `/api/projects/${made.data.id}`, undefined, h)).status, 200);
    // their own AI budget
    assert.equal((await tight.api('GET', '/api/ai/status', undefined, h)).data.capUsd, tight.app.ctx.cfg.party.userAiCapUsd);
  } finally {
    await tight.close();
  }
});

test('with accounts off (a laptop), rooms are anonymous, the library is shared and nothing changes', async () => {
  const open = await startApp();
  try {
    assert.equal((await open.api('POST', '/api/party/rooms')).status, 201);
    assert.equal((await open.api('GET', '/api/me')).data.loginRequired, false);
    assert.equal((await open.api('GET', '/api/projects')).status, 200);
  } finally {
    await open.close();
  }
});

test('a party server with accounts off serves no studio at all', async () => {
  const bare = await startApp({ mode: 'party' });
  try {
    assert.equal((await bare.api('GET', '/api/projects')).status, 404);
    assert.equal((await fetch(`${bare.base}/studio/`)).status, 404);
  } finally {
    await bare.close();
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

test('everyone shares the server’s OpenRouter key and none of them ever sees it', async () => {
  const secret = 'sk-or-v1-THIS-MUST-NEVER-REACH-A-BROWSER-0123456789';
  // an upstream that fails and repeats the key it was given, as a careless provider might
  const up = await mockOpenRouter((b, n) => ({ status: 401, json: { error: { message: `bad credentials ${secret} (call ${n}, model ${b.model})` } } }));
  const srv = await startApp({ mode: 'party', auth: { provider: 'dev' }, apiKey: secret, ai: { openrouterBase: up.url } });
  try {
    const cookie = await signIn(srv.base, 'Pau');
    const headers = { cookie };
    const bodies: string[] = [];
    for (const [method, url, body] of [
      ['GET', '/api/me'],
      ['GET', '/api/system'],
      ['GET', '/api/ai/status'],
      ['POST', '/api/ai/rewrite', { task: 'translate', cues: [{ id: 'a', text: 'Hello', start: 0, end: 2 }], params: { outLang: 'es' } }],
      ['GET', '/api/party/info'],
    ] as const) {
      const r = await srv.api(method, url, body, headers);
      bodies.push(`${r.status} ${JSON.stringify(r.data)} ${[...r.headers.entries()].join(';')}`);
    }
    assert.ok(up.reqs.length > 0, 'the upstream was really called, with the shared key');
    assert.equal(up.reqs[0].headers.authorization, `Bearer ${secret}`);
    for (const b of bodies) assert.ok(!b.includes(secret), `the key leaked in: ${b.slice(0, 160)}`);
    assert.match(bodies[3], /\[key\]/, 'the failure came back with the key scrubbed out');
  } finally {
    await srv.close();
    await up.close();
  }
});
