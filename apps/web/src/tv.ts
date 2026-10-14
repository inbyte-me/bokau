import { app } from './app.svelte.ts';

/** TV ("10-foot") mode: bigger UI, fullscreen. Leaving fullscreen leaves TV mode. */
export function toggleTv(force?: boolean): void {
  app.tv = typeof force === 'boolean' ? force : !app.tv;
  document.documentElement.classList.toggle('tv', app.tv);
  if (app.tv) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) void document.exitFullscreen?.();
  app.emit('tv', app.tv);
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && app.tv) {
    app.tv = false;
    document.documentElement.classList.remove('tv');
    app.emit('tv', false);
  }
});
