// `npm run doctor` — checks the things this app depends on and prints how to fix what's missing.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { loadEnv } from '../server/config.js';
loadEnv();
const ok = (m) => console.log('  ✅', m), bad = (m, fix) => console.log('  ❌', m, fix ? `\n      → ${fix}` : ''), warn = (m) => console.log('  ⚠️ ', m);
const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return null; } };
console.log('\nDoblaje Studio — environment check\n');
const major = Number(process.versions.node.split('.')[0]); major >= 22 ? ok(`Node ${process.version}`) : bad(`Node ${process.version} is too old`, 'nvm install 24 && nvm use 24');
const ff = run('ffmpeg', ['-version']); ff ? ok(ff.split('\n')[0]) : bad('ffmpeg not found', 'brew install ffmpeg');
if (ff) {
  const filters = run('ffmpeg', ['-hide_banner', '-filters']) || '', enc = run('ffmpeg', ['-hide_banner', '-encoders']) || '';
  for (const f of ['acrossover', 'afftdn', 'overlay', 'loudnorm', 'silencedetect']) filters.includes(` ${f} `) ? ok(`ffmpeg filter ${f}`) : bad(`ffmpeg lacks filter ${f}`);
  for (const e of ['libx264', 'aac', 'libvpx-vp9', 'libopus']) enc.includes(` ${e} `) ? ok(`ffmpeg encoder ${e}`) : (e.startsWith('libvpx') || e === 'libopus' ? warn(`ffmpeg lacks ${e} (WebM export unavailable)`) : bad(`ffmpeg lacks encoder ${e}`));
}
fs.existsSync(new URL('../node_modules/@huggingface/transformers', import.meta.url)) ? ok('npm dependencies installed') : bad('dependencies missing', 'npm install');
process.env.OPENROUTER_API_KEY ? ok('OPENROUTER_API_KEY found (AI features on; cheap default model, local spend cap)') : warn('No OPENROUTER_API_KEY in .env — translation is off, party games use the offline generator');
if (process.platform === 'darwin') {
  const a = spawnSync('system_profiler', ['SPAudioDataType'], { encoding: 'utf8' }).stdout || '';
  const inputs = [...a.matchAll(/^\s{8}(\S.*):\s*\n(?:\s{10}.*\n)*?\s{10}Input Channels: (\d+)/gm)].map((m) => `${m[1]} (${m[2]} ch)`);
  console.log('\n  Audio inputs macOS can see:'); inputs.length ? inputs.forEach((i) => console.log('    •', i)) : console.log('    (none)');
  const usb = spawnSync('system_profiler', ['SPUSBDataType'], { encoding: 'utf8' }).stdout || '';
  /audio|interface|codec|usb.*mic/i.test(usb) ? ok('a USB audio device is on the bus') : warn('no USB audio interface on the USB bus yet — check the cable (data, not charge-only) and port');
}
console.log('\nStart with: npm start   →   http://localhost:5177\n');
