// `pnpm doctor`: checks what the app depends on and prints how to fix what's missing. Changes nothing.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const ok = (m: string) => console.log('  ok   ', m);
const bad = (m: string, fix?: string) => console.log('  FAIL ', m, fix ? `\n         -> ${fix}` : '');
const warn = (m: string) => console.log('  warn ', m);
const run = (cmd: string, args: string[]) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
};

console.log('\nDoblaje Studio: environment check\n');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major > 24 || (major === 24 && minor >= 11)) ok(`Node ${process.version}`);
else bad(`Node ${process.version}: 24.11+ is needed (built-in SQLite and TypeScript type stripping)`, 'nvm install 24 && nvm use 24');
const pnpm = run('pnpm', ['--version']) || run('corepack', ['pnpm', '--version']);
if (pnpm) ok(`pnpm ${pnpm.trim().split('\n').pop()}`);
else bad('pnpm not found', 'corepack enable pnpm');

const ff = run('ffmpeg', ['-version']);
if (ff) ok(ff.split('\n')[0]);
else bad('ffmpeg not found', 'brew install ffmpeg');
if (ff) {
  const filters = run('ffmpeg', ['-hide_banner', '-filters']) || '';
  const enc = run('ffmpeg', ['-hide_banner', '-encoders']) || '';
  for (const f of ['acrossover', 'afftdn', 'overlay', 'loudnorm', 'silencedetect', 'ebur128']) {
    if (filters.includes(` ${f} `)) ok(`ffmpeg filter ${f}`);
    else bad(`ffmpeg lacks filter ${f}`);
  }
  for (const e of ['libx264', 'aac', 'libmp3lame', 'libvpx-vp9', 'libopus']) {
    if (enc.includes(` ${e} `)) ok(`ffmpeg encoder ${e}`);
    else if (e.startsWith('libvpx') || e === 'libopus') warn(`ffmpeg lacks ${e} (WebM export unavailable)`);
    else bad(`ffmpeg lacks encoder ${e}`);
  }
}
if (fs.existsSync(path.join(root, 'node_modules', '.pnpm'))) ok('dependencies installed');
else bad('dependencies missing', 'pnpm install');
if (fs.existsSync(path.join(root, 'apps', 'web', 'dist', 'index.html'))) ok('web app built');
else warn('web app not built yet (pnpm build, or use pnpm dev)');
if (fs.existsSync(path.join(root, 'tools', 'venv', 'bin', 'python'))) ok('neural separator installed (Demucs)');
else warn('neural separator not installed: mono clips cannot be split (pnpm setup:separation, ~1 GB)');
if (process.env.OPENROUTER_API_KEY) ok('OPENROUTER_API_KEY found (AI features on; cheap default model, local spend cap)');
else warn('No OPENROUTER_API_KEY in .env: translation is off, party games use the offline generator');

if (process.platform === 'darwin') {
  const a = spawnSync('system_profiler', ['SPAudioDataType'], { encoding: 'utf8' }).stdout || '';
  const inputs = [...a.matchAll(/^\s{8}(\S.*):\s*\n(?:\s{10}.*\n)*?\s{10}Input Channels: (\d+)/gm)].map((m) => `${m[1]} (${m[2]} ch)`);
  console.log('\n  Audio inputs macOS can see:');
  for (const i of inputs.length ? inputs : ['(none)']) console.log('    -', i);
  const usb = spawnSync('system_profiler', ['SPUSBDataType'], { encoding: 'utf8' }).stdout || '';
  if (/audio|interface|codec|usb.*mic/i.test(usb)) ok('a USB audio device is on the bus');
  else warn('no USB audio interface on the USB bus (fine if you use the built-in mic)');
}
console.log('\nStart with: pnpm start  ->  http://localhost:5177   (or pnpm dev, or pnpm desktop)\n');
