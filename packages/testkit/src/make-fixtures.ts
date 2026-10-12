// `pnpm fixtures [--force]`: (re)generate the test media.
import { make } from './fixtures.ts';

console.log('fixtures in', make({ force: process.argv.includes('--force') }));
