// Bundles the main process (ESM) and the preload (CommonJS, required for sandboxed preloads) with esbuild,
// and copies the runtime assets the backend serves: database migrations and the speech libraries.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { type BuildOptions, build } from 'esbuild';

const here = import.meta.dirname;
const out = path.join(here, 'dist');
fs.rmSync(out, { recursive: true, force: true });

const common: BuildOptions = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  external: ['electron', '@napi-rs/canvas'],
  logLevel: 'warning',
};
await build({
  ...common,
  entryPoints: [path.join(here, 'src/main.ts')],
  outfile: path.join(out, 'main.js'),
  format: 'esm',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
await build({ ...common, entryPoints: [path.join(here, 'src/preload.ts')], outfile: path.join(out, 'preload.cjs'), format: 'cjs' });
// the "OpenRouter key" window: its own preload, page and script
await build({ ...common, entryPoints: [path.join(here, 'src/preload-key.ts')], outfile: path.join(out, 'preload-key.cjs'), format: 'cjs' });
await build({
  ...common,
  platform: 'browser',
  target: 'chrome140',
  entryPoints: [path.join(here, 'src/key-window.ts')],
  outfile: path.join(out, 'key.js'),
  format: 'iife',
});
fs.copyFileSync(path.join(here, 'src/key.html'), path.join(out, 'key.html'));

const repo = path.resolve(here, '..', '..');
fs.cpSync(path.join(repo, 'packages/db/drizzle'), path.join(out, 'drizzle'), { recursive: true });
const req = createRequire(path.join(repo, 'packages/api/package.json'));
const transformers = path.dirname(req.resolve('@huggingface/transformers'));
const ort = path.dirname(createRequire(req.resolve('@huggingface/transformers')).resolve('onnxruntime-web'));
// Only what the browser speech worker loads: the transformers.js web bundle and the WASM runtime it picks.
const pick: [string, string, RegExp][] = [
  ['transformers', transformers, /^transformers\.min\.js$/],
  ['ort', ort, /^ort-wasm-simd-threaded\.(asyncify|jsep)?\.?(mjs|wasm)$/],
];
for (const [name, dir, re] of pick) {
  fs.mkdirSync(path.join(out, 'vendor', name), { recursive: true });
  for (const f of fs.readdirSync(dir).filter((x) => re.test(x))) fs.copyFileSync(path.join(dir, f), path.join(out, 'vendor', name, f));
}
console.log('desktop bundle ->', path.relative(repo, out));
