import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AiLedger, closeDatabase, openDatabase, SqliteProjectRepository } from '../src/index.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'doblaje-db-'));

test('migrations create the schema and are idempotent', () => {
  const dir = tmp();
  const file = path.join(dir, 'app.db');
  closeDatabase(openDatabase({ file }));
  const db = openDatabase({ file }); // second open runs no migration twice
  const tables = db.$client
    .prepare("select name from sqlite_master where type = 'table' order by name")
    .all()
    .map((r) => r.name);
  for (const t of ['ai_calls', 'meta', 'projects']) assert.ok(tables.includes(t), `${t} in ${tables}`);
  closeDatabase(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('project repository: create, get, update keeps server-owned fields, list order, remove', () => {
  const dir = tmp();
  const db = openDatabase({ file: ':memory:' });
  const repo = new SqliteProjectRepository(db, path.join(dir, 'projects'));
  const a = repo.create({ name: 'First', mode: 'podcast' });
  assert.equal(a.mode, 'podcast');
  assert.ok(fs.existsSync(path.join(repo.dir(a.id), 'takes')));
  const b = repo.create({ name: 'Second', mode: 'nonsense' });
  assert.equal(b.mode, 'pro', 'unknown modes fall back to pro');

  const withMedia = repo.get(a.id);
  withMedia.media = { duration: 3 } as never;
  repo.save(withMedia);
  const u = repo.update(a.id, { name: 'Renamed', cues: [{ id: 'c1', start: 0, end: 1, text: 'hola', character: '', note: '' }], media: null } as never);
  assert.equal(u.name, 'Renamed');
  assert.equal(u.media?.duration, 3, 'client cannot overwrite media');
  assert.equal(repo.get(a.id).cues[0].text, 'hola');

  const list = repo.list();
  assert.deepEqual(
    list.map((p) => p.id),
    [a.id, b.id],
    'most recently updated first',
  );
  assert.equal(list[0].cues, 1);

  assert.throws(() => repo.get('pmissing01'), /not found/);
  assert.throws(() => repo.get('../etc'), /bad project id/);
  repo.remove(a.id);
  assert.equal(repo.exists(a.id), false);
  assert.equal(fs.existsSync(path.join(dir, 'projects', a.id)), false);
  closeDatabase(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ai ledger sums the reported cost', () => {
  const db = openDatabase({ file: ':memory:' });
  const l = new AiLedger(db);
  assert.deepEqual(l.totals(), { usd: 0, calls: 0, tokens: 0 });
  l.record({ model: 'qwen/qwen3.7-flash', task: 'badlip', costUsd: 0.00004, tokens: 900 });
  l.record({ model: 'qwen/qwen3.7-flash', costUsd: 0.0001, tokens: 100 });
  const t = l.totals();
  assert.equal(t.calls, 2);
  assert.equal(t.tokens, 1000);
  assert.ok(Math.abs(t.usd - 0.00014) < 1e-12);
  closeDatabase(db);
});

test('library clips: derive projects that share media (hard links) and copy the prepared work, never recordings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doblaje-db-'));
  const db = openDatabase({ file: ':memory:' });
  const repo = new SqliteProjectRepository(db, path.join(dir, 'projects'));
  const clip = repo.create({ name: 'Movie scene', template: true });
  fs.writeFileSync(path.join(repo.dir(clip.id), 'proxy.mp4'), 'video');
  fs.writeFileSync(path.join(repo.dir(clip.id), 'stem_dialogue.wav'), 'dialogue');
  fs.writeFileSync(path.join(repo.dir(clip.id), 'takes', 'take_x.wav'), 'a recording');
  const c = repo.get(clip.id);
  c.media = { ready: true, duration: 10 } as never;
  c.cues = [{ id: 'c1', start: 0, end: 1, text: 'Hola', character: 'Ana', note: '' }];
  c.speakers = { list: [{ id: 's1', name: 'Ana', color: '#fff', muted: true, solo: false }], segments: [{ start: 0, end: 1, speaker: 's1' }] };
  repo.save(c);

  assert.throws(() => repo.derive(repo.create({ name: 'not a clip' }).id, { mode: 'party' }), /not a library clip/);
  const party = repo.derive(clip.id, { mode: 'party', name: 'Round 1' });
  assert.equal(party.mode, 'party');
  assert.equal(party.template, false);
  assert.equal(party.sourceTemplateId, clip.id);
  assert.equal(party.cues[0].character, 'Ana');
  assert.equal(party.speakers.list[0].muted, false, 'voices start on in a new project');
  assert.equal(party.tracks[0].clips.length, 0);
  const a = fs.statSync(path.join(repo.dir(clip.id), 'proxy.mp4'));
  const b = fs.statSync(path.join(repo.dir(party.id), 'proxy.mp4'));
  assert.equal(a.ino, b.ino, 'media is hard-linked, not copied');
  assert.ok(!fs.existsSync(path.join(repo.dir(party.id), 'takes', 'take_x.wav')), 'recordings never come along');

  // edits stay independent; library listing separates clips from projects
  repo.update(party.id, { cues: [] } as never);
  assert.equal(repo.get(clip.id).cues.length, 1);
  assert.deepEqual(
    repo.list({ template: true }).map((p) => p.id),
    [clip.id],
  );
  assert.ok(repo.list({ template: false }).some((p) => p.id === party.id));
  assert.equal(repo.update(party.id, { template: true } as never).template, false, 'the client cannot turn a project into a clip');
  // deleting the clip leaves derived projects playable (their hard links keep the bytes)
  repo.remove(clip.id);
  assert.equal(fs.readFileSync(path.join(repo.dir(party.id), 'proxy.mp4'), 'utf8'), 'video');
  closeDatabase(db);
  fs.rmSync(dir, { recursive: true, force: true });
});
