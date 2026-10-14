import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createVault, masterKeyFrom } from '../src/library/vault.ts';

const master = crypto.randomBytes(32);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
/** a clip folder with files of awkward sizes (empty, one byte, exactly a chunk, a few chunks and a bit) */
function clip(chunk: number) {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'takes'));
  const files: Record<string, Buffer> = {
    'empty.bin': Buffer.alloc(0),
    'one.bin': Buffer.from([7]),
    'exact.bin': crypto.randomBytes(chunk),
    'proxy.mp4': crypto.randomBytes(chunk * 3 + 17),
    'takes/t.wav': crypto.randomBytes(chunk * 2),
  };
  for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), b);
  return { dir, files };
}

test('sealing: every file is encrypted and the plain ones are gone; opening gives the exact bytes back', () => {
  const v = createVault(master, { chunkSize: 64 });
  const { dir, files } = clip(64);
  assert.equal(v.isSealed(dir), false);
  assert.equal(v.seal(dir), Object.keys(files).length);
  assert.equal(v.isSealed(dir), true);
  const left = fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile());
  assert.deepEqual(left.sort(), [...Object.keys(files).map((f) => `${f}.enc`), 'sealed.json'].sort());
  for (const f of left.filter((x) => x.endsWith('.enc')))
    assert.ok(!fs.readFileSync(path.join(dir, 'proxy.mp4.enc')).includes(files['proxy.mp4'].subarray(0, 40)), 'the bytes are not in the clear');

  const room = tmp();
  v.open(dir, room, (n) => !n.startsWith('takes/'));
  for (const [n, b] of Object.entries(files)) {
    if (n.startsWith('takes/')) assert.ok(!fs.existsSync(path.join(room, n)), 'only what was asked for');
    else assert.ok(fs.readFileSync(path.join(room, n)).equals(b), n);
  }
  assert.ok(v.read(dir, 'one.bin').equals(files['one.bin']));
  assert.equal(v.seal(dir), 0, 'sealing again changes nothing');
  assert.equal(v.unseal(dir), Object.keys(files).length);
  for (const [n, b] of Object.entries(files)) assert.ok(fs.readFileSync(path.join(dir, n)).equals(b));
  assert.equal(v.isSealed(dir), false);
});

test('a tampered, truncated or swapped file is refused; so is the wrong master key', () => {
  const v = createVault(master, { chunkSize: 64 });
  const { dir } = clip(64);
  v.seal(dir);
  const enc = path.join(dir, 'proxy.mp4.enc');
  const good = fs.readFileSync(enc);
  const to = tmp();

  const flipped = Buffer.from(good);
  flipped[40] ^= 1;
  fs.writeFileSync(enc, flipped);
  assert.throws(() => v.open(dir, to, (n) => n === 'proxy.mp4'), /unable to authenticate|Unsupported state/i);

  fs.writeFileSync(enc, good.subarray(0, good.length - (64 + 16))); // a whole chunk cut off the end
  assert.throws(() => v.open(dir, to, (n) => n === 'proxy.mp4'));

  fs.writeFileSync(enc, good);
  v.open(dir, to, (n) => n === 'proxy.mp4'); // restored: fine again

  const other = createVault(crypto.randomBytes(32), { chunkSize: 64 });
  assert.throws(() => other.open(dir, to, () => true), /another master key/);
  assert.throws(() => other.seal(dir), /another master key/);
});

test('an interrupted seal can be finished: the clip keeps its key and nothing is lost', () => {
  const v = createVault(master, { chunkSize: 64 });
  const { dir, files } = clip(64);
  v.seal(dir);
  // a new file appears (and one stale plain file from a crashed run): sealing again takes them in with the same key
  fs.writeFileSync(path.join(dir, 'late.bin'), 'late');
  assert.equal(v.seal(dir), 1);
  assert.ok(v.read(dir, 'late.bin').equals(Buffer.from('late')));
  assert.ok(v.read(dir, 'proxy.mp4').equals(files['proxy.mp4']));
});

test('the master key comes from a base64 value or a file, and must be 32 bytes', () => {
  const k = crypto.randomBytes(32);
  assert.ok(masterKeyFrom({ key: k.toString('base64') })?.equals(k));
  const f = path.join(tmp(), 'key');
  fs.writeFileSync(f, `${k.toString('base64')}\n`);
  assert.ok(masterKeyFrom({ file: f })?.equals(k));
  assert.equal(masterKeyFrom({}), null);
  assert.throws(() => masterKeyFrom({ key: 'c2hvcnQ=' }), /32 random bytes/);
});
