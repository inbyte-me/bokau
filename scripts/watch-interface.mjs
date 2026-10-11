// `npm run watch:interface` — waits until macOS shows a NEW audio input (e.g. your USB interface), then runs the
// real-hardware test against exactly that device. Ctrl+C to stop. Optional: WATCH_MINUTES=20 (default 30).
import { spawnSync } from 'node:child_process';
const inputs = () => { const out = spawnSync('system_profiler', ['SPAudioDataType'], { encoding: 'utf8' }).stdout || ''; return [...out.matchAll(/^\s{8}(\S.*):\s*\n(?:\s{10}.*\n)*?\s{10}Input Channels: (\d+)/gm)].map((m) => ({ name: m[1], ch: Number(m[2]) })); };
const base = new Set(inputs().map((i) => i.name)); console.log('Known inputs:', [...base].join(' | ') || '(none)'); console.log('Waiting for a new audio input… plug in / re-seat the interface.');
const until = Date.now() + (Number(process.env.WATCH_MINUTES) || 30) * 60000;
while (Date.now() < until) {
  const now = inputs(); const fresh = now.filter((i) => !base.has(i.name));
  if (fresh.length) {
    const d = fresh[0]; console.log(`\nNEW INPUT DETECTED: ${d.name} (${d.ch} ch). Running the live test against it…\n`);
    const r = spawnSync('node', ['--test', 'test/e2e/live-mic.test.js'], { env: { ...process.env, LIVE_MIC: '1', LIVE_DEVICE: d.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }, stdio: 'inherit' });
    console.log(r.status === 0 ? '\nINTERFACE TEST PASSED' : '\nINTERFACE TEST FAILED'); process.exit(r.status ?? 1);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
console.log('\nNo new audio input appeared within the time limit.'); process.exit(2);
