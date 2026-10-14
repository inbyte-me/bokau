// Clips and who they belong to. On a server of accounts every person has a library of their own (`<data>/users/<id>/`); a laptop has
// one shared library. Prepared clips travel between them as one file. Run it where the data folder is:
//   pnpm library list [--user <id>]                     the clips of a library (a person's, or the shared one)
//   pnpm library export <clipId> <file.tar> [--user <id>]   pack a prepared clip (on the computer that prepared it)
//   pnpm library import <file.tar> [--user <id>]        unpack it as a new clip (sealed when the server has a library key)
//   pnpm library seal <clipId> [--user <id>]            encrypt a clip's files at rest (needs LIBRARY_KEY or LIBRARY_KEY_FILE)
//   pnpm library unseal <clipId> [--user <id>]          decrypt them again (maintenance)
//   pnpm library users                                  the people who have libraries on this server
import fs from 'node:fs';
import path from 'node:path';
import { closeDatabase, openDatabase, SqliteProjectRepository } from '@doblaje/db';
import { loadConfig } from './config.ts';
import { exportClip, importClip } from './library/bundle.ts';
import { createVault } from './library/vault.ts';

const args = process.argv.slice(2);
const at = args.indexOf('--user');
const user = at >= 0 ? args.splice(at, 2)[1] : null;
const [command, first, second] = args;
const cfg = loadConfig();
if (user && !/^[A-Za-z0-9_]{3,80}$/.test(user)) throw new Error(`not a user id: ${user}`);
const dir = user ? path.join(cfg.dataDir, 'users', user) : cfg.dataDir;
if (command === 'users') {
  const base = path.join(cfg.dataDir, 'users');
  for (const u of fs.existsSync(base) ? fs.readdirSync(base) : []) console.log(u);
  process.exit(0);
}
if (user && !fs.existsSync(dir)) throw new Error(`${user} has no library on this server`);
const db = openDatabase({ file: path.join(dir, 'doblaje.db'), migrationsFolder: cfg.migrationsDir });
const vault = cfg.libraryKey ? createVault(cfg.libraryKey) : null;
const projects = new SqliteProjectRepository(db, path.join(dir, 'projects'), vault);
const needVault = () => {
  if (!vault) throw new Error('set LIBRARY_KEY (or LIBRARY_KEY_FILE): openssl rand -base64 32');
  return vault;
};
try {
  if (command === 'list') {
    for (const c of projects.list({ template: true }))
      console.log(`${c.id}  ${c.ready ? 'ready    ' : 'not ready'}  ${vault?.isSealed(projects.dir(c.id)) ? 'sealed  ' : 'in clear'}  ${c.name}`);
  } else if (command === 'export' && first && second) {
    console.log(`wrote ${second}: ${(await exportClip(projects, vault, first, second)).join(', ')}`);
  } else if (command === 'import' && first) {
    const id = await importClip(projects, vault, first);
    console.log(`imported as ${id}${user ? ` into the library of ${user}` : ''}${vault ? ', sealed' : ''}`);
  } else if (command === 'seal' && first) {
    console.log(`sealed ${needVault().seal(projects.dir(first))} file(s) of ${first}`);
  } else if (command === 'unseal' && first) {
    console.log(`unsealed ${needVault().unseal(projects.dir(first))} file(s) of ${first}`);
  } else {
    console.error('usage: pnpm library list|export <clipId> <file.tar>|import <file.tar>|seal <clipId>|unseal <clipId> [--user <id>] | users');
    process.exitCode = 1;
  }
} finally {
  closeDatabase(db);
}
