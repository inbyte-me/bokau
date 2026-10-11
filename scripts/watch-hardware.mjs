// `npm run watch:hardware` — waits for NEW audio hardware and tests it for real, whichever comes first:
//   a new input  (USB interface, headset)        -> record + meter + transcribe through it   (test/e2e/live-mic.test.js)
//   a new output (TV over HDMI/DisplayPort, USB) -> route the app's sound there, measure latency (test/e2e/live-output.test.js)
// WATCH_MINUTES=30 by default. Leave it running, plug things in.
import { spawnSync } from 'node:child_process';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function snapshot() {
  const out = spawnSync('system_profiler', ['SPAudioDataType'], { encoding: 'utf8' }).stdout || ''; const ins = new Set(), outs = new Set();
  for (const m of out.matchAll(/^\s{8}(\S.*):\s*\n((?:\s{10}.*\n)+)/gm)) { if (/Input Channels: [1-9]/.test(m[2])) ins.add(m[1]); if (/Output Channels: [1-9]/.test(m[2])) outs.add(m[1]); }
  const io = spawnSync('ioreg', ['-r', '-c', 'IOAudioEngine', '-l'], { encoding: 'utf8' }).stdout || ''; for (const m of io.matchAll(/"IOAudioEngineDescription" = "([^"]+)"/g)) outs.add(m[1]);
  return { ins, outs };
}
const base = snapshot(); console.log('Known inputs :', [...base.ins].join(' | ')); console.log('Known outputs:', [...base.outs].join(' | ')); console.log('Waiting for new hardware… plug in the interface / turn on the TV.');
const until = Date.now() + (Number(process.env.WATCH_MINUTES) || 30) * 60000; let code = 0, ran = 0;
while (Date.now() < until && ran < 2) {
  await new Promise((r) => setTimeout(r, 3000)); const now = snapshot();
  for (const d of [...base.ins]) if (!now.ins.has(d)) { base.ins.delete(d); console.log(`(input gone: ${d})`); } // unplugged -> a re-plug counts as new
  for (const d of [...base.outs]) if (!now.outs.has(d)) { base.outs.delete(d); console.log(`(output gone: ${d})`); }
  const newIn = [...now.ins].filter((x) => !base.ins.has(x)), newOut = [...now.outs].filter((x) => !base.outs.has(x));
  for (const d of newIn) { base.ins.add(d); console.log(`\nNEW INPUT: ${d}\n`); const r = spawnSync('node', ['--test', 'test/e2e/live-mic.test.js'], { env: { ...process.env, LIVE_MIC: '1', LIVE_DEVICE: esc(d.replace(/ \(.*\)$/, '')) }, stdio: 'inherit' }); console.log(r.status === 0 ? '\nINPUT TEST PASSED' : '\nINPUT TEST FAILED'); code ||= r.status ?? 1; ran++; }
  for (const d of newOut) { base.outs.add(d); console.log(`\nNEW OUTPUT: ${d}\n`); const r = spawnSync('node', ['--test', 'test/e2e/live-output.test.js'], { env: { ...process.env, LIVE_MIC: '1', LIVE_OUTPUT: esc(d.replace(/ \(.*\)$/, '')) }, stdio: 'inherit' }); console.log(r.status === 0 ? '\nOUTPUT TEST PASSED' : '\nOUTPUT TEST FAILED'); code ||= r.status ?? 1; ran++; }
}
if (!ran) console.log('\nNo new audio hardware appeared within the time limit.'); process.exit(ran ? code : 2);
