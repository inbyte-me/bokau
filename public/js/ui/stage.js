import { h } from '../util.js';
import { t } from '../i18n.js';
import { app } from '../app.js';
import { Karaoke } from './karaoke.js';

/** Video + overlays (countdown, REC badge, optional cue banner). */
export class Stage {
  constructor() {
    this.video = h('video#video', { playsInline: true, muted: true, preload: 'auto', disablePictureInPicture: true });
    this.video.src = `/media/${app.project.id}/proxy.mp4`;
    this.count = h('div.overlay'); this.rec = h('div.recbadge.hidden', h('i'), h('span', t('REC')));
    this.banner = h('div.cue-banner.hidden'); this.kara = new Karaoke(this.banner);
    this.el = h('div.stage', this.video, this.banner, this.count, this.rec);
    this.offs = [
      app.engine.on('time', (tm) => this.banner.classList.contains('off') ? 0 : this.kara.update(tm)),
      app.engine.on('pause', () => this.kara.update(app.engine.time)),
      app.session.on('countdown', (n) => this.#countdown(n)),
      app.session.on('state', (s) => { this.rec.classList.toggle('hidden', s !== 'recording'); if (s !== 'countdown') this.count.replaceChildren(); }),
    ];
  }
  showBanner(on) { this.banner.classList.toggle('off', !on); if (!on) this.banner.classList.add('hidden'); else this.kara.update(app.engine.time); }
  #countdown(n) { this.count.replaceChildren(h('div.countdown' + (n === 0 ? '.go' : ''), n === 0 ? t('GO') : String(n))); }
  destroy() { this.offs.forEach((f) => f()); this.video.removeAttribute('src'); this.video.load(); }
}
