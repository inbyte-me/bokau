// The deployment files must keep up with what the server reads: every environment variable in `config.ts` is either passed by
// docker-compose.yml, set by the Dockerfile, or listed here as deliberately not set (with the reason), and `.env.example` names it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REPO_ROOT } from '../src/config.ts';

const read = (f: string) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
const varsOf = (source: string) => [...new Set([...source.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]))].sort();

/** read by the server, but not for the compose stack */
const NOT_FOR_COMPOSE: Record<string, string> = {
  DOBLAJE_DATA: 'set by the Dockerfile (/data, the volume)',
  DOBLAJE_MODELS: 'set by the Dockerfile (/data/models)',
  HOST: 'set by the Dockerfile (0.0.0.0)',
  PORT: 'set by the Dockerfile (5177): Caddy proxies to it',
  FFMPEG: 'ffmpeg is installed in the image',
  FFPROBE: 'ffprobe is installed in the image',
  TLS_CERT: 'Traefik terminates HTTPS; the app speaks plain HTTP inside the stack',
  TLS_KEY: 'same',
  PARTY_PORT: 'studio mode only (the Wi-Fi listener); a party server has one listener',
  PARTY_HOST: 'studio mode only',
  OPENROUTER_BASE: 'a test hook (a mock of OpenRouter)',
  LIBRARY_KEY_FILE: 'a file path needs a mounted secret; compose passes the key itself (LIBRARY_KEY)',
};

test('docker-compose.yml passes every setting the server reads (or says why not)', () => {
  const compose = read('docker-compose.yml');
  const app = compose.slice(compose.indexOf('  app:'), compose.indexOf('  caddy:'));
  const passed = new Set([...app.matchAll(/^\s{6}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]));
  const wanted = varsOf(read('packages/api/src/config.ts')).concat(varsOf(read('apps/server/src/main.ts')));
  const missing = [...new Set(wanted)].filter((v) => !passed.has(v) && !(v in NOT_FOR_COMPOSE));
  assert.deepEqual(missing, [], `add these to the app's environment in docker-compose.yml (or to NOT_FOR_COMPOSE with a reason)`);
  // and nothing in the list of exceptions is stale: it is a variable the server really reads, and compose really leaves out
  for (const v of Object.keys(NOT_FOR_COMPOSE)) {
    assert.ok(wanted.includes(v), `${v} is no longer read by the server: drop it from NOT_FOR_COMPOSE`);
    assert.ok(!passed.has(v), `${v} is passed by compose: drop it from NOT_FOR_COMPOSE`);
  }
  // everything compose passes is something the server reads (DOMAIN only feeds interpolation)
  const unknown = [...passed].filter((v) => !wanted.includes(v));
  assert.deepEqual(
    unknown,
    ['DOBLAJE_MODE'].filter((v) => !wanted.includes(v)),
    'compose passes a variable the server does not read',
  );
});

test('docker-compose.yml: the app is only reachable through Caddy, which is only reachable through Dokploy', () => {
  const compose = read('docker-compose.yml');
  assert.ok(!/^\s+ports:/m.test(compose), 'no host port is published (Traefik owns 80/443)');
  assert.match(compose, /DOMAIN:\?/, 'the domain is required');
  assert.match(compose, /TRUST_PROXY: \$\{TRUST_PROXY:-2\}/, 'two proxies in front');
  assert.match(read('deploy/Caddyfile'), /auto_https off/, 'Caddy must not ask for certificates behind Traefik');
});

test('.env.example names every setting the server reads', () => {
  const example = read('.env.example');
  const wanted = varsOf(read('packages/api/src/config.ts')).filter((v) => v !== 'OPENROUTER_BASE');
  const missing = wanted.filter((v) => !new RegExp(`^#? ?${v}=`, 'm').test(example));
  assert.deepEqual(missing, [], 'document these in .env.example');
});
