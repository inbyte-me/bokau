import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// The phone app. The server serves the build at /play/ on both listeners (localhost and the Wi-Fi HTTPS one).
// `pnpm --filter @doblaje/play dev` serves it with hot reload on :5174 against the API on :5177 (desktop browsers only:
// phones need the HTTPS listener, so test phones against the built app, `pnpm dev` rebuilds it on change).
const API = process.env.DOBLAJE_API || 'http://127.0.0.1:5177';

export default defineConfig({
  base: '/play/',
  plugins: [svelte()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: API },
      '/party': { target: API, ws: true },
      '/sounds': { target: API },
    },
  },
  worker: { format: 'es' },
  build: {
    target: ['es2022', 'safari16'],
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: { input: { index: 'index.html', grid: 'grid.html' } },
  },
});
