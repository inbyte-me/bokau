import { h, clear, toast } from './util.js';
import { t, getLang, setLang, onLang } from './i18n.js';
import { api } from './api.js';
import { app } from './app.js';
import { mountLibrary } from './ui/library.js';
import { icon } from './icons.js';

const root = document.getElementById('app');
let current = null;

export function go(path) { location.hash = '#' + path; }

function topbar(extra) {
  const lang = h('select', { id: 'lang', title: 'Language', onchange: (e) => { setLang(e.target.value); route(); } }, h('option', { value: 'en', selected: getLang() === 'en' }, 'English'), h('option', { value: 'es', selected: getLang() === 'es' }, 'Español'));
  const ai = h('span.chip', { id: 'ai-chip', title: t('OpenRouter usage (hard-capped locally)') }, '…');
  api.system().then((s) => { app.system = s; ai.textContent = s.ai.configured ? `AI $${s.ai.spentUsd.toFixed(3)} / $${s.ai.capUsd}` : t('AI offline'); ai.classList.add(s.ai.configured ? 'ok' : 'warn'); }).catch(() => { ai.textContent = t('server?'); });
  const tv = h('button.icon', { id: 'tv-btn', title: t('TV mode (big UI, fullscreen)'), onclick: toggleTv }, icon('tv'));
  return h('div.topbar', h('div.brand', { onclick: () => go('/') }, h('span.dot'), 'Doblaje Studio'), ...(extra || []), h('div.spacer'), ai, lang, tv);
}
export function toggleTv(force) {
  app.tv = typeof force === 'boolean' ? force : !app.tv;
  document.documentElement.classList.toggle('tv', app.tv);
  if (app.tv) document.documentElement.requestFullscreen?.().catch(() => {}); else if (document.fullscreenElement) document.exitFullscreen?.();
  app.emit('tv', app.tv);
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && app.tv) { app.tv = false; document.documentElement.classList.remove('tv'); app.emit('tv', false); } });

async function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  if (current?.destroy) { try { await current.destroy(); } catch (e) { console.error(e); } current = null; }
  clear(root); root.append(topbar());
  const body = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }); root.append(body);
  const m = /^\/p\/([\w-]+)/.exec(hash);
  try {
    if (m) {
      const proj = await app.store.open(m[1]);
      const mod = proj.mode === 'party' ? await import('./ui/party/party.js') : proj.mode === 'podcast' ? await import('./ui/podcast.js') : await import('./ui/studio.js');
      current = await mod.mount(body, { go, topbar: root.firstChild });
    } else { app.store.close(); mountLibrary(body, { go }); }
  } catch (e) { console.error(e); toast(e.message, 'error'); body.append(h('div.empty', { style: { margin: '2rem' } }, e.message, h('div', h('button', { onclick: () => go('/') }, t('Back to projects'))))); }
}
window.addEventListener('hashchange', route);
onLang(() => {});
route();
