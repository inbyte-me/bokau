import assert from 'node:assert/strict';
import test from 'node:test';
import { Gate, Jobs } from '../src/jobs.ts';

const never = () => new Promise<never>(() => {});

test('a person has one heavy job at a time, and the server runs only so many at once', async () => {
  const gate = new Gate(2);
  const pau = new Jobs({ perPerson: 1, gate });
  const leo = new Jobs({ perPerson: 1, gate });
  const eve = new Jobs({ perPerson: 1, gate });
  pau.run('ingest', never);
  assert.throws(() => pau.run('ingest', never), /still running/, 'a second job of the same person');
  leo.run('ingest', never);
  assert.throws(() => eve.run('ingest', never), /server is busy/, 'a third at once, whoever asks');
  assert.equal(gate.running, 2);
});

test('finishing a job frees its place, for them and for everyone', async () => {
  const gate = new Gate(1);
  const a = new Jobs({ perPerson: 1, gate });
  const b = new Jobs({ perPerson: 1, gate });
  const done = a.run('ingest', async () => 'ok');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(done.status, 'done');
  assert.equal(gate.running, 0);
  const failed = b.run('ingest', async () => {
    throw new Error('boom');
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(failed.status, 'error');
  assert.equal(gate.running, 0, 'a failed job frees it too');
  assert.doesNotThrow(() => a.run('ingest', async () => 'again'));
});

test('without limits (a laptop) nothing is held back', () => {
  const j = new Jobs();
  for (let i = 0; i < 5; i++) j.run('ingest', never);
});
