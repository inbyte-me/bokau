// Who owns which library clip. Clips are prepared in the studio and copied into a server's data folder; until hosts can
// upload their own, this assigns them. Run it where the data folder is (stop the server first on a busy machine):
//   pnpm library list                       the clips and their owners
//   pnpm library assign <clipId> <userId>   make a clip private to a person (their id from the identity provider)
//   pnpm library release <clipId>           back to the starter pack (every host may pick it)
//   pnpm library export <clipId> <file.tar>      pack a prepared clip (here, on the computer that prepared it)
//   pnpm library import <file.tar> [userId]      unpack it as a new library clip (owned by the person, and sealed when there is a key)
//   pnpm library seal <clipId>               encrypt the clip's files at rest (needs LIBRARY_KEY or LIBRARY_KEY_FILE)
//   pnpm library unseal <clipId>             decrypt them again (maintenance)
// `assign` seals the clip too when the server has a library key.
import { closeDatabase, openDatabase, SqliteProjectRepository, UserRepository } from '@doblaje/db';
import { loadConfig } from './config.ts';
import { exportClip, importClip } from './library/bundle.ts';
import { createVault } from './library/vault.ts';

const [command, clipId, userId] = process.argv.slice(2);
const cfg = loadConfig();
const db = openDatabase({ file: cfg.dbFile, migrationsFolder: cfg.migrationsDir });
const projects = new SqliteProjectRepository(db, cfg.projectsDir);
const users = new UserRepository(db);
const vault = cfg.libraryKey ? createVault(cfg.libraryKey) : null;
const needVault = () => {
  if (!vault) throw new Error('set LIBRARY_KEY (or LIBRARY_KEY_FILE): openssl rand -base64 32');
  return vault;
};
try {
  if (command === 'list') {
    for (const c of projects.list({ template: true }))
      console.log(
        `${c.id}  ${c.ready ? 'ready    ' : 'not ready'}  ${vault?.isSealed(projects.dir(c.id)) ? 'sealed  ' : 'in clear'}  ${(users.ownerOf(c.id) ?? 'starter pack').padEnd(24)}  ${c.name}`,
      );
  } else if (command === 'assign' && clipId && userId) {
    if (!projects.get(clipId).template) throw new Error(`${clipId} is not a library clip`);
    users.claim(clipId, userId);
    console.log(`${clipId} now belongs to ${userId}`);
    if (vault) console.log(`  sealed ${vault.seal(projects.dir(clipId))} file(s)`);
    else console.log('  (no library key set: its files stay unencrypted)');
  } else if (command === 'release' && clipId) {
    users.release(clipId);
    console.log(`${clipId} is in the starter pack`);
  } else if (command === 'export' && clipId && userId) {
    const files = await exportClip(projects, vault, clipId, userId);
    console.log(`wrote ${userId}: ${files.join(', ')}`);
  } else if (command === 'import' && clipId) {
    const id = await importClip(projects, users, vault, clipId, { owner: userId ?? null });
    console.log(`imported as ${id}${userId ? `, owned by ${userId}` : ' (starter pack)'}${vault ? ', sealed' : ''}`);
  } else if (command === 'seal' && clipId) {
    console.log(`sealed ${needVault().seal(projects.dir(clipId))} file(s) of ${clipId}`);
  } else if (command === 'unseal' && clipId) {
    console.log(`unsealed ${needVault().unseal(projects.dir(clipId))} file(s) of ${clipId}`);
  } else {
    console.error(
      'usage: pnpm library list | export <clipId> <file.tar> | import <file.tar> [userId] | assign <clipId> <userId> | release <clipId> | seal <clipId> | unseal <clipId>',
    );
    process.exitCode = 1;
  }
} finally {
  closeDatabase(db);
}
