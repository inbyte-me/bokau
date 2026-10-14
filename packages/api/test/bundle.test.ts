import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startApp } from '@doblaje/testkit';
import { exportClip, importClip } from '../src/library/bundle.ts';
import { createVault } from '../src/library/vault.ts';

test('a prepared clip travels as one file: exported here, imported there owned by a host and sealed, and it plays', async () => {
  const studio = await startApp();
  const key = crypto.randomBytes(32);
  const server = await startApp({ mode: 'party', libraryKey: key });
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-')), 'clip.tar');
  try {
    const id = await studio.ingestFixture('clip_voices.mp4', 'pro', { template: true });
    await studio.api('PUT', `/api/projects/${id}`, {
      name: 'Heist',
      speakers: { list: [{ id: 'A', name: 'Ana', color: '#d97b66', muted: false, solo: false }], segments: [] },
      cues: [{ id: 'c1', start: 0.5, end: 2, text: 'Hola, ¿qué tal?', character: 'Ana', note: '' }],
    });
    const files = await exportClip(studio.app.ctx.projects, null, id, out);
    assert.ok(files.includes('clip.json') && files.includes('proxy.mp4') && files.some((f) => f.startsWith('source.')));
    assert.ok(!files.some((f) => f.includes('takes') || f.includes('exports')), 'no recordings or exports in a clip');

    const vault = createVault(key);
    const imported = await importClip(server.app.ctx.projects, server.app.ctx.users, vault, out, { owner: 'user_pau' });
    assert.notEqual(imported, id, 'a new clip on the server');
    const clip = server.app.ctx.projects.get(imported);
    assert.equal(clip.name, 'Heist');
    assert.equal(clip.template, true);
    assert.equal(clip.cues[0].text, 'Hola, ¿qué tal?', 'the characters and lines came along');
    assert.equal(server.app.ctx.users.ownerOf(imported), 'user_pau');
    const dir = server.app.ctx.projects.dir(imported);
    assert.ok(vault.isSealed(dir) && !fs.existsSync(path.join(dir, 'proxy.mp4')), 'sealed on arrival');

    // it plays: a round derived from the sealed clip has the real media
    const round = server.app.ctx.projects.derive(imported, { mode: 'party' });
    assert.ok(fs.statSync(server.app.ctx.projects.file(round.id, 'proxy.mp4')).size > 1000);
    // and exporting it again from the server (sealed) works with the key
    const again = path.join(path.dirname(out), 'again.tar');
    assert.ok((await exportClip(server.app.ctx.projects, vault, imported, again)).includes('proxy.mp4'));
  } finally {
    await studio.close();
    await server.close();
  }
});

test('a bundle with odd entries or no media is refused and leaves nothing behind', async () => {
  const server = await startApp({ mode: 'party' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-bad-'));
  try {
    const { exec } = await import('@doblaje/media');
    fs.writeFileSync(
      path.join(dir, 'clip.json'),
      JSON.stringify({ format: 1, project: { media: { ready: true, proxy: 'proxy.mp4', sourceFile: 'source.mp4' } } }),
    );
    fs.writeFileSync(path.join(dir, 'evil.sh'), 'x');
    await exec('tar', ['-cf', path.join(dir, 'bad.tar'), '-C', dir, 'clip.json', 'evil.sh']);
    const before = server.app.ctx.projects.list().length;
    await assert.rejects(importClip(server.app.ctx.projects, server.app.ctx.users, null, path.join(dir, 'bad.tar')), /unexpected entry/);
    fs.rmSync(path.join(dir, 'evil.sh'));
    await exec('tar', ['-cf', path.join(dir, 'empty.tar'), '-C', dir, 'clip.json']);
    await assert.rejects(importClip(server.app.ctx.projects, server.app.ctx.users, null, path.join(dir, 'empty.tar')), /missing the clip/);
    assert.equal(server.app.ctx.projects.list().length, before, 'nothing was created');
  } finally {
    await server.close();
  }
});
