import { clear, getLang, h, icon, installContextMenus, onLang, setLang, t, toast } from '@doblaje/ui';
import { api } from './api.ts';
import { app } from './app.ts';
import { devicesChip } from './features/devices.ts';
import { mountLibrary, newProjectModal } from './features/library.ts';
import { fileMenuButton, installSaveShortcuts } from './features/save.ts';
import { toggleTv } from './tv.ts';
import './styles/app.css';

/** What a full-screen feature returns so the router can tear it down. */
export interface Mounted {
  destroy?(): void | Promise<void>;
}
export interface MountCtx {
  go(path: string): void;
  topbar: HTMLElement;
}

const root = document.getElementById('app') as HTMLElement;
let current: Mounted | null = null;
let chipCleanup: (() => void) | null = null;

export function go(path: string): void {
  location.hash = `#${path}`;
}

function topbar(): HTMLElement {
  const lang = h(
    'select#lang',
    {
      title: 'Language',
      onchange: (e) => {
        setLang(e.target.value);
        void route();
      },
    },
    h('option', { value: 'en', selected: getLang() === 'en' }, 'English'),
    h('option', { value: 'es', selected: getLang() === 'es' }, 'Español'),
  );
  const ai = h('span.chip#ai-chip', { title: t('OpenRouter usage (hard-capped locally)') }, '…');
  api
    .system()
    .then((s) => {
      app.system = s;
      ai.textContent = s.ai.configured ? `AI $${s.ai.spentUsd.toFixed(3)} / $${s.ai.capUsd}` : t('AI offline');
      ai.classList.add(s.ai.configured ? 'ok' : 'warn');
    })
    .catch(() => {
      ai.textContent = t('server?');
    });
  const devices = devicesChip();
  chipCleanup?.();
  chipCleanup = devices.destroy;
  const tv = h('button.icon#tv-btn', { title: t('TV mode (big UI, fullscreen)'), onclick: () => toggleTv() }, icon('tv'));
  return h(
    'div.topbar',
    h('div.brand', { onclick: () => go('/') }, h('span.dot'), 'Doblaje Studio'),
    fileMenuButton(go),
    h('div.spacer'),
    devices.el,
    ai,
    lang,
    tv,
  );
}

async function route(): Promise<void> {
  const hash = location.hash.replace(/^#/, '') || '/';
  if (current?.destroy) {
    try {
      await current.destroy();
    } catch (e) {
      console.error(e);
    }
  }
  current = null;
  clear(root);
  const bar = topbar();
  root.append(bar);
  const body = h('div', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' } });
  root.append(body);
  const m = /^\/p\/([\w-]+)/.exec(hash);
  try {
    if (m) {
      const proj = await app.store.open(m[1]);
      const mod =
        proj.mode === 'party'
          ? await import('./features/party/party.ts')
          : proj.mode === 'podcast'
            ? await import('./features/podcast.ts')
            : await import('./features/studio.ts');
      current = await mod.mount(body, { go, topbar: bar });
    } else if (hash === '/party') {
      app.store.close();
      const { mountPartyPicker } = await import('./features/party/pick.ts');
      current = mountPartyPicker(body, { go });
    } else {
      app.store.close();
      mountLibrary(body, { go });
      if (hash === '/new') {
        newProjectModal({ go });
        history.replaceState(null, '', '#/'); // so File → New works again after cancelling
      }
    }
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    toast(msg, 'error');
    body.append(h('div.empty', { style: { margin: '2rem' } }, msg, h('div', h('button', { onclick: () => go('/') }, t('Back to projects')))));
  }
}
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

window.addEventListener('hashchange', () => void route());
onLang(() => {});
void route();
