import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generate } from 'selfsigned';

export interface Certificate {
  key: string;
  cert: string;
  fingerprint: string;
  names: string[];
}

/**
 * The party listener's self-signed certificate. Phones only allow the microphone on HTTPS, and a self-signed
 * certificate works offline: each guest confirms it once ("continue anyway"). Kept in `dir` and reused while
 * it still covers every name and address this machine answers to (a new Wi-Fi network adds one).
 */
export async function ensureCertificate(dir: string, ips: string[]): Promise<Certificate> {
  const host = os.hostname().replace(/\.local$/, '');
  const names = [...new Set(['localhost', `${host}.local`, '127.0.0.1', ...ips])];
  const file = path.join(dir, 'party-tls.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as Certificate & { notAfter: string };
    const fresh = new Date(saved.notAfter).getTime() - Date.now() > 7 * 86_400_000;
    if (fresh && names.every((n) => saved.names.includes(n))) return saved;
  } catch {}
  const notBeforeDate = new Date(Date.now() - 86_400_000);
  const notAfterDate = new Date(Date.now() + 365 * 86_400_000);
  const pems = await generate([{ name: 'commonName', value: 'Doblaje Studio party' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: names.map((n) => (/^[\d.]+$/.test(n) ? { type: 7, ip: n } : { type: 2, value: n })) },
    ],
  });
  const out = { key: pems.private, cert: pems.cert, fingerprint: pems.fingerprint, names, notAfter: notAfterDate.toISOString() };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out), { mode: 0o600 });
  return out;
}
