// The library at rest. A sealed clip's files are stored encrypted (AES-256-GCM, in chunks so a long video streams), each
// clip with its own random data key, and that key is wrapped by a master key the operator keeps outside the data folder
// (a file or an environment variable on the server). A leaked disk, backup or copy of the data folder is then noise.
// What it does not do: the server must read a clip to run a room, so a running server that is compromised can too.
// A room decrypts a working copy into its own folder, which is deleted when the room empties.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ClipVault } from '@doblaje/db';

const MAGIC = Buffer.from('DBLJ1\0');
const HEADER = MAGIC.length + 8 + 4;
const TAG = 16;
export const MANIFEST = 'sealed.json';
const DEFAULT_CHUNK = 1024 * 1024;

interface Manifest {
  v: 1;
  /** which master key wrapped the data key (a fingerprint, not the key) */
  kid: string;
  /** the clip's data key, wrapped by the master key */
  key: string;
  /** file (relative to the clip's folder) → sha256 of its plain content */
  files: Record<string, string>;
}

export interface Vault extends ClipVault {
  /** the content of one file of a sealed clip (small files: a poster) */
  read(dir: string, name: string): Buffer;
  /** encrypt every file of a clip's folder and delete the plain ones (safe to repeat) */
  seal(dir: string): number;
  /** decrypt a sealed clip back in place (maintenance) */
  unseal(dir: string): number;
}

const kidOf = (master: Buffer) => crypto.createHash('sha256').update('dblj-kid').update(master).digest('hex').slice(0, 12);

/** A master key from `LIBRARY_KEY` (base64 of 32 random bytes: `openssl rand -base64 32`) or a file holding it. */
export function masterKeyFrom({ key, file }: { key?: string; file?: string }): Buffer | null {
  const raw = key || (file ? fs.readFileSync(file, 'utf8') : '');
  if (!raw.trim()) return null;
  const k = Buffer.from(raw.trim(), 'base64');
  if (k.length !== 32) throw new Error('LIBRARY_KEY must be 32 random bytes in base64 (openssl rand -base64 32)');
  return k;
}

export function createVault(master: Buffer, { chunkSize = DEFAULT_CHUNK }: { chunkSize?: number } = {}): Vault {
  if (master.length !== 32) throw new Error('the master key must be 32 bytes');
  const kid = kidOf(master);

  const wrap = (dataKey: Buffer): string => {
    const nonce = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', master, nonce);
    c.setAAD(Buffer.from('dblj-key'));
    const ct = Buffer.concat([c.update(dataKey), c.final()]);
    return [nonce, ct, c.getAuthTag()].map((b) => b.toString('base64url')).join('.');
  };
  const unwrap = (wrapped: string): Buffer => {
    const [nonce, ct, tag] = wrapped.split('.').map((x) => Buffer.from(x, 'base64url'));
    const d = crypto.createDecipheriv('aes-256-gcm', master, nonce);
    d.setAAD(Buffer.from('dblj-key'));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  };
  const manifestOf = (dir: string): Manifest | null => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8')) as Manifest;
    } catch {
      return null;
    }
  };
  const keyOf = (m: Manifest): Buffer => {
    if (m.kid !== kid) throw new Error('this clip was sealed with another master key');
    return unwrap(m.key);
  };
  const aad = (i: number, last: boolean) => {
    const b = Buffer.alloc(5);
    b.writeUInt32BE(i, 0);
    b.writeUInt8(last ? 1 : 0, 4);
    return b;
  };
  const nonce = (base: Buffer, i: number) => {
    const n = Buffer.alloc(12);
    base.copy(n, 0);
    n.writeUInt32BE(i, 8);
    return n;
  };

  /** encrypt `src` into `dest`; returns the sha256 of the plain content */
  function encryptFile(src: string, dest: string, dataKey: Buffer): string {
    const fd = fs.openSync(src, 'r');
    const out = fs.openSync(dest, 'w', 0o600);
    try {
      const size = fs.fstatSync(fd).size;
      const chunks = Math.max(1, Math.ceil(size / chunkSize));
      const base = crypto.randomBytes(8);
      const head = Buffer.alloc(HEADER);
      MAGIC.copy(head, 0);
      base.copy(head, MAGIC.length);
      head.writeUInt32BE(chunkSize, MAGIC.length + 8);
      fs.writeSync(out, head);
      const hash = crypto.createHash('sha256');
      const buf = Buffer.alloc(chunkSize);
      for (let i = 0; i < chunks; i++) {
        const n = fs.readSync(fd, buf, 0, chunkSize, i * chunkSize);
        hash.update(buf.subarray(0, n));
        const c = crypto.createCipheriv('aes-256-gcm', dataKey, nonce(base, i));
        c.setAAD(aad(i, i === chunks - 1));
        fs.writeSync(out, Buffer.concat([c.update(buf.subarray(0, n)), c.final(), c.getAuthTag()]));
      }
      return hash.digest('hex');
    } finally {
      fs.closeSync(fd);
      fs.closeSync(out);
    }
  }

  /** decrypt `src` chunk by chunk, handing each plain chunk to `sink`; returns the sha256 of the plain content */
  function decryptFile(src: string, dataKey: Buffer, sink: (plain: Buffer) => void): string {
    const fd = fs.openSync(src, 'r');
    try {
      const total = fs.fstatSync(fd).size;
      const head = Buffer.alloc(HEADER);
      if (fs.readSync(fd, head, 0, HEADER, 0) !== HEADER || !head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a sealed file');
      const base = head.subarray(MAGIC.length, MAGIC.length + 8);
      const size = head.readUInt32BE(MAGIC.length + 8);
      const chunks = Math.max(1, Math.ceil((total - HEADER) / (size + TAG)));
      const hash = crypto.createHash('sha256');
      const buf = Buffer.alloc(size + TAG);
      for (let i = 0; i < chunks; i++) {
        const n = fs.readSync(fd, buf, 0, size + TAG, HEADER + i * (size + TAG));
        if (n < TAG) throw new Error('a sealed file is cut short');
        const d = crypto.createDecipheriv('aes-256-gcm', dataKey, nonce(base, i));
        d.setAAD(aad(i, i === chunks - 1));
        d.setAuthTag(buf.subarray(n - TAG, n));
        const plain = Buffer.concat([d.update(buf.subarray(0, n - TAG)), d.final()]);
        hash.update(plain);
        sink(plain);
      }
      return hash.digest('hex');
    } finally {
      fs.closeSync(fd);
    }
  }

  const walk = (root: string, rel = ''): string[] =>
    fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
      const r = rel ? `${rel}/${e.name}` : e.name;
      return e.isDirectory() ? walk(root, r) : e.isFile() ? [r] : [];
    });

  function decryptTo(from: string, name: string, dest: string, dataKey: Buffer): string {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const out = fs.openSync(dest, 'w', 0o600);
    try {
      return decryptFile(path.join(from, `${name}.enc`), dataKey, (plain) => fs.writeSync(out, plain));
    } catch (e) {
      fs.rmSync(dest, { force: true });
      throw e;
    } finally {
      fs.closeSync(out);
    }
  }

  return {
    isSealed: (dir) => fs.existsSync(path.join(dir, MANIFEST)),

    seal(dir) {
      const manifest = manifestOf(dir);
      const dataKey = manifest ? keyOf(manifest) : crypto.randomBytes(32);
      const m: Manifest = manifest ?? { v: 1, kid, key: wrap(dataKey), files: {} };
      let sealed = 0;
      for (const name of walk(dir).filter((f) => f !== MANIFEST && !f.endsWith('.enc'))) {
        const plain = path.join(dir, name);
        const enc = `${plain}.enc`;
        const tmp = `${enc}.tmp`;
        const sha = encryptFile(plain, tmp, dataKey);
        // read it back before the plain file goes: a sealed clip that cannot be opened would be a lost clip
        const check = decryptFile(tmp, dataKey, () => {});
        if (check !== sha) {
          fs.rmSync(tmp, { force: true });
          throw new Error(`could not verify the sealed copy of ${name}`);
        }
        fs.renameSync(tmp, enc);
        m.files[name] = sha;
        fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m), { mode: 0o600 });
        fs.rmSync(plain);
        sealed++;
      }
      fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m), { mode: 0o600 });
      return sealed;
    },

    unseal(dir) {
      const m = manifestOf(dir);
      if (!m) return 0;
      const dataKey = keyOf(m);
      let n = 0;
      for (const name of Object.keys(m.files)) {
        const sha = decryptTo(dir, name, path.join(dir, name), dataKey);
        if (sha !== m.files[name]) throw new Error(`${name} does not match what was sealed`);
        fs.rmSync(path.join(dir, `${name}.enc`));
        n++;
      }
      fs.rmSync(path.join(dir, MANIFEST));
      return n;
    },

    open(from, to, keep) {
      const m = manifestOf(from);
      if (!m) throw new Error('this clip is not sealed');
      const dataKey = keyOf(m);
      for (const name of Object.keys(m.files).filter((f) => keep(f))) {
        const sha = decryptTo(from, name, path.join(to, name), dataKey);
        if (sha !== m.files[name]) throw new Error(`${name} does not match what was sealed`);
      }
    },

    read(dir, name) {
      const m = manifestOf(dir);
      if (!m || !(name in m.files)) throw new Error('no such sealed file');
      const parts: Buffer[] = [];
      decryptFile(path.join(dir, `${name}.enc`), keyOf(m), (p) => parts.push(p));
      return Buffer.concat(parts);
    },
  };
}
