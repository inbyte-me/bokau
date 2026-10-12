import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Starts the real Electron shell with a hidden window (DOBLAJE_SMOKE=1): the embedded backend opens its
// database, the window loads the web build, and the shell reports what it saw and quits. Silent.
// The test runner marks its children (NODE_TEST_CONTEXT); Electron's embedded Node must not see that.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST') && k !== 'NODE_OPTIONS'));
const desktop = path.resolve(import.meta.dirname, '..', 'apps', 'desktop');

test('desktop shell boots the embedded backend and renders the library', { timeout: 120_000 }, () => {
  const build = spawnSync(process.execPath, ['build.ts'], { cwd: desktop, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const electron = createRequire(path.join(desktop, 'package.json'))('electron') as unknown as string;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doblaje-desktop-'));
  try {
    const r = spawnSync(electron, ['.'], {
      cwd: desktop,
      encoding: 'utf8',
      timeout: 90_000,
      env: { ...cleanEnv(), DOBLAJE_SMOKE: '1', DOBLAJE_DATA: dataDir },
    });
    const line = `${r.stdout}`.split('\n').find((l) => l.startsWith('SMOKE '));
    assert.ok(line, `no smoke report; exit ${r.status}\n${r.stderr}`);
    const report = JSON.parse(line.slice(6));
    assert.equal(report.title, 'Doblaje Studio');
    assert.equal(report.health.ok, true);
    assert.match(report.node, /^24\./, 'Electron must ship Node 24 for node:sqlite and type stripping');
    assert.ok(fs.existsSync(path.join(dataDir, 'doblaje.db')), 'database created in the data folder');
    // run from the repository, the desktop app must use the repo's tools (where `pnpm setup:separation` installs Demucs)
    const repoTools = path.resolve(desktop, '..', '..', 'tools');
    assert.equal(report.toolsDir, repoTools);
    const lib = path.join(repoTools, 'venv', 'lib');
    const installed = fs.existsSync(lib) && fs.readdirSync(lib).some((d) => fs.existsSync(path.join(lib, d, 'site-packages', 'demucs')));
    assert.equal(report.neuralSeparation, installed, 'the neural separator is detected exactly when it is installed');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
