// A host's clip kept encrypted in their library: it plays in their room from a working copy, and only ciphertext is at rest.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { PlayerView, ServerMessage } from '@doblaje/party';
import { startApp } from '@doblaje/testkit';
import { exportClip, importClip } from '../src/library/bundle.ts';
import { createVault } from '../src/library/vault.ts';
import { Client } from './support/party.ts';

const welcome = (m: ServerMessage): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome';

test('a sealed clip plays in its owner’s room; the library keeps no plain file; the room’s copy goes when the room empties', async () => {
  const key = crypto.randomBytes(32);
  const vault = createVault(key);
  const app = await startApp({ mode: 'party', auth: { provider: 'dev' }, libraryKey: key, party: { emptyRoomMinutes: 0.03 } });
  const studio = await startApp();
  try {
    // a clip prepared elsewhere arrives in Pau's library as a bundle, sealed on the way in
    const made = await studio.ingestFixture('clip_voices.mp4', 'pro', { template: true });
    await studio.api('PUT', `/api/projects/${made}`, {
      speakers: { list: [{ id: 'A', name: 'Ana', color: '#d97b66', muted: false, solo: false }], segments: [] },
      cues: [{ id: 'c1', start: 0.5, end: 2, text: 'Hola, ¿qué tal?', character: 'Ana', note: '' }],
    });
    const plainProxy = fs.readFileSync(`${studio.dir(made)}/proxy.mp4`);
    const tar = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sealed-')), 'clip.tar');
    await exportClip(studio.app.ctx.projects, null, made, tar);
    const lib = app.app.ctx.workspaces.get('dev_pau');
    const clipId = await importClip(lib.projects, vault, tar);
    const dir = lib.projects.dir(clipId);
    assert.ok(!fs.existsSync(`${dir}/proxy.mp4`) && fs.existsSync(`${dir}/proxy.mp4.enc`), 'only ciphertext at rest');
    assert.ok(!fs.readFileSync(`${dir}/proxy.mp4.enc`).includes(plainProxy.subarray(100, 140)), 'and it really is encrypted');

    const cookie = (await fetch(`${app.base}/auth/callback?code=Pau`, { redirect: 'manual' })).headers.get('set-cookie')?.split(';')[0] ?? '';
    // it is in his library (the document), but its media is not served in the clear: unseal it to edit
    const mine = (await app.api('GET', '/api/projects?kind=clips', undefined, { cookie })).data as { id: string }[];
    assert.deepEqual(
      mine.map((c) => c.id),
      [clipId],
    );
    assert.equal((await fetch(`${app.base}/media/${clipId}/proxy.mp4`, { headers: { cookie } })).status, 404);

    const room = (await app.api('POST', '/api/party/rooms', undefined, { cookie })).data;
    const host = new Client(app.base);
    await host.open();
    host.send({ type: 'hello-player', code: room.code, name: 'Pau', hostKey: room.hostKey });
    const token = (await host.next(welcome)).token;
    // the poster is decrypted on the way out
    const poster = await fetch(`${app.base}/party/${room.code}/clips/${clipId}/poster.jpg?t=${token}`);
    assert.equal(poster.status, 200);
    assert.equal(
      Buffer.from(await poster.arrayBuffer())
        .subarray(0, 2)
        .toString('hex'),
      'ffd8',
      'a real JPEG',
    );

    host.send({ type: 'host', command: { type: 'pick-clip', clipId } });
    host.send({ type: 'host', command: { type: 'cast' } });
    const cast = await host.view<PlayerView>((v) => v.board.phase === 'casting');
    const round = cast.board.projectId;
    assert.ok(round);
    assert.ok(fs.readFileSync(`${lib.projects.dir(round)}/proxy.mp4`).equals(plainProxy), 'the room works on a decrypted copy, byte for byte');
    const media = await fetch(`${app.base}/party/${room.code}/media/proxy.mp4?t=${token}`);
    assert.equal(media.status, 200);
    await media.body?.cancel();

    host.close();
    for (let i = 0; i < 80 && fs.existsSync(lib.projects.dir(round)); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(!fs.existsSync(lib.projects.dir(round)), 'the room’s copy is gone with the room');
    assert.ok(fs.existsSync(`${dir}/proxy.mp4.enc`) && !fs.existsSync(`${dir}/proxy.mp4`), 'the library is still sealed');
  } finally {
    await app.close();
    await studio.close();
  }
});

test('a sealed clip with no library key on the server is refused, not served broken', async () => {
  const key = crypto.randomBytes(32);
  const app = await startApp({ libraryKey: null });
  try {
    const clipId = await app.ingestFixture('clip_voices.mp4', 'pro', { template: true });
    createVault(key).seal(app.dir(clipId));
    const r = await app.api('POST', `/api/projects/${clipId}/derive`, { mode: 'party' });
    assert.equal(r.status, 500);
    assert.match(JSON.stringify(r.data), /no library key/);
  } finally {
    await app.close();
  }
});
