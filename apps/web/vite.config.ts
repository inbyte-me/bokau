import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// The API server (apps/server) owns /api, /media, /hf and /vendor. In development Vite serves the UI with
// hot reload and proxies those paths; in production the server serves the built files from ./dist.
const API = process.env.DOBLAJE_API || 'http://127.0.0.1:5177';
const proxied = ['/api', '/media', '/hf', '/vendor', '/sounds', '/play'];

export default defineConfig({
  // screens are moving to Svelte one by one (party room first); the rest is still plain TypeScript + h()
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      ...Object.fromEntries(proxied.map((p) => [p, { target: API, changeOrigin: false }])),
      '/party/ws': { target: API, ws: true },
    },
  },
  // relative asset paths: the same build is served at / (the laptop and the desktop app) and at /studio/ (a server of accounts)
  base: './',
  // audio worklets and the speech worker are ES modules
  worker: { format: 'es' },
  build: {
    target: 'es2023',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
