import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { es } from '../../../packages/ui/src/lang-es.ts';

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
// every folder with user-facing strings

const SOURCES = ['apps/web/src', 'packages/ui/src', 'packages/audio/src', 'packages/speech/src'].map((d) => path.join(repo, d));
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    fs.statSync(p).isDirectory() ? walk(p, out) : p.endsWith('.ts') && !p.includes('lang-') && out.push(p);
  }
  return out;
};

test('every t("…") string in the UI has a Spanish translation', () => {
  const missing = new Set();
  for (const f of SOURCES.flatMap((d) => walk(d))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) {
      const k = (m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"');
      if (!(k in es)) missing.add(k);
    }
  }
  assert.deepEqual([...missing], []);
});

test('placeholders are preserved in translations', () => {
  for (const [k, v] of Object.entries(es)) {
    const a = (k.match(/\{\w+\}/g) || []).sort().join(),
      b = (v.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(b, a, `placeholder mismatch for "${k}"`);
  }
});

test('dynamic labels (fx names, models, advice, genres, premises) are translated', () => {
  for (const k of [
    'Clean',
    'Walkie-Talkie',
    'Monster',
    'Helium',
    'Ghost',
    'Tiny multilingual (≈40 MB, fastest)',
    'Noir Detective',
    'Pirate Swashbuckler',
    'two people arguing about lost cheese',
    'Your mic level and noise floor look good. 👍',
  ])
    assert.ok(es[k], k);
});
