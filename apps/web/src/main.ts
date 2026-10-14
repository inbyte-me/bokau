// Frontend entry: the Svelte app (App.svelte) plus the few page-wide behaviours installed once.
import { installContextMenus } from '@doblaje/ui';
import { mount } from 'svelte';
import App from './App.svelte';
import { installSaveShortcuts } from './features/save.ts';
import { go } from './router.svelte.ts';
import './styles/app.css';

// Lets the e2e tests drive the real modules inside the page (same code the app runs).
declare global {
  interface Window {
    __testing: { audio: () => Promise<typeof import('@doblaje/audio')>; speech: () => Promise<typeof import('@doblaje/speech')> };
  }
}
window.__testing = { audio: () => import('@doblaje/audio'), speech: () => import('@doblaje/speech') };

// Right-click policy: app menus where there are relevant actions, native menu on text fields and links, nothing elsewhere.
installContextMenus();
installSaveShortcuts(go);

mount(App, { target: document.getElementById('app') as HTMLElement });
