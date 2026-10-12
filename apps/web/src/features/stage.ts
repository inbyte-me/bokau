import { h, t } from '@doblaje/ui';
import { app } from '../app.ts';
import { Karaoke } from './karaoke.ts';

/** Video + overlays (countdown, REC badge, optional cue banner). */
export class Stage {
  readonly video: HTMLVideoElement;
  readonly count = h('div.overlay');
  readonly rec = h('div.recbadge.hidden', h('i'), h('span', t('REC')));
  readonly banner = h('div.cue-banner.hidden');
  readonly kara = new Karaoke(this.banner);
  readonly el: HTMLElement;
  readonly #offs: (() => void)[];

  constructor() {
    this.video = h('video#video', { playsInline: true, muted: true, preload: 'auto', disablePictureInPicture: true });
    this.video.src = `/media/${app.project.id}/proxy.mp4`;
    this.el = h('div.stage', this.video, this.banner, this.count, this.rec);
    this.#offs = [
      app.engine.on('time', (tm) => {
        if (!this.banner.classList.contains('off')) this.kara.update(tm);
      }),
      app.engine.on('pause', () => this.kara.update(app.engine.time)),
      app.session.on('countdown', (n) => this.#countdown(n)),
      app.session.on('state', (s) => {
        this.rec.classList.toggle('hidden', s !== 'recording');
        if (s === 'idle') this.count.replaceChildren();
        else if (s === 'recording') setTimeout(() => this.count.replaceChildren(), 600);
      }),
    ];
  }
  showBanner(on: boolean): void {
    this.banner.classList.toggle('off', !on);
    if (!on) this.banner.classList.add('hidden');
    else this.kara.update(app.engine.time);
  }
  #countdown(n: number) {
    this.count.replaceChildren(h(`div.countdown${n === 0 ? '.go' : ''}`, n === 0 ? t('GO') : String(n)));
  }
  destroy(): void {
    for (const off of this.#offs) off();
    this.video.removeAttribute('src');
    this.video.load();
  }
}
