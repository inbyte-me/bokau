// `pnpm watch:hardware`: waits for NEW audio hardware and tests it for real, whichever comes first:
//   a new input  (USB interface, headset)        -> record + meter + transcribe through it   (e2e/live-mic.test.ts)
//   a new output (TV over HDMI/DisplayPort, USB) -> route the app's sound there, measure latency (e2e/live-output.test.ts)
// The output test plays audible clicks. WATCH_MINUTES=30 by default. Leave it running, plug things in.
import { spawnSync } from 'node:child_process';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const strip = (s: string) => esc(s.replace(/ \(.*\)$/, ''));

function snapshot(): { ins: Set<string>; outs: Set<string> } {
  const out = spawnSync('system_profiler', ['SPAudioDataType'], { encoding: 'utf8' }).stdout || '';
  const ins = new Set<string>();
  const outs = new Set<string>();
  for (const m of out.matchAll(/^\s{8}(\S.*):\s*\n((?:\s{10}.*\n)+)/gm)) {
    if (/Input Channels: [1-9]/.test(m[2])) ins.add(m[1]);
    if (/Output Channels: [1-9]/.test(m[2])) outs.add(m[1]);
  }
  const io = spawnSync('ioreg', ['-r', '-c', 'IOAudioEngine', '-l'], { encoding: 'utf8' }).stdout || '';
  for (const m of io.matchAll(/"IOAudioEngineDescription" = "([^"]+)"/g)) outs.add(m[1]);
  return { ins, outs };
}

const runTest = (file: string, env: Record<string, string>) =>
  spawnSync(process.execPath, ['--test', file], { env: { ...process.env, LIVE_MIC: '1', ...env }, stdio: 'inherit' }).status ?? 1;

const base = snapshot();
console.log('Known inputs :', [...base.ins].join(' | ') || '(none)');
console.log('Known outputs:', [...base.outs].join(' | ') || '(none)');
console.log('Waiting for new hardware… plug in the interface / turn on the TV.');
const until = Date.now() + (Number(process.env.WATCH_MINUTES) || 30) * 60000;
let code = 0;
let ran = 0;
while (Date.now() < until && ran < 2) {
  await new Promise((r) => setTimeout(r, 3000));
  const now = snapshot();
  // unplugged devices are forgotten, so plugging them back in counts as new
  for (const d of [...base.ins]) if (!now.ins.has(d)) base.ins.delete(d);
  for (const d of [...base.outs]) if (!now.outs.has(d)) base.outs.delete(d);
  for (const d of [...now.ins].filter((x) => !base.ins.has(x))) {
    base.ins.add(d);
    console.log(`\nNEW INPUT: ${d}\n`);
    const s = runTest('e2e/live-mic.test.ts', { LIVE_DEVICE: strip(d) });
    console.log(s === 0 ? '\nINPUT TEST PASSED' : '\nINPUT TEST FAILED');
    code ||= s;
    ran++;
  }
  for (const d of [...now.outs].filter((x) => !base.outs.has(x))) {
    base.outs.add(d);
    console.log(`\nNEW OUTPUT: ${d}\n`);
    const s = runTest('e2e/live-output.test.ts', { LIVE_OUTPUT: strip(d) });
    console.log(s === 0 ? '\nOUTPUT TEST PASSED' : '\nOUTPUT TEST FAILED');
    code ||= s;
    ran++;
  }
}
if (!ran) console.log('\nNo new audio hardware appeared within the time limit.');
process.exit(ran ? code : 2);
