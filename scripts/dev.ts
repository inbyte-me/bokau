// `pnpm dev`: API server (restarts on backend changes) + Vite (hot reload for the UI) together.
// Open http://localhost:5173. Ctrl+C stops both.
import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const procs: ChildProcess[] = [
  spawn(process.execPath, ['--watch-path=apps/server/src', '--watch-path=packages', 'apps/server/src/main.ts'], { cwd: root, stdio: 'inherit' }),
  spawn('pnpm', ['--filter', '@doblaje/web', 'dev'], { cwd: root, stdio: 'inherit' }),
];
const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (c) => c && stop());
