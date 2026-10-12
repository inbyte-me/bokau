import { type Cue, detectLang, type WordTiming, wordTimings } from '@doblaje/core';
import { clear, h } from '@doblaje/ui';
import { app } from '../app.ts';

export type KaraokeCue = Pick<Cue, 'start' | 'end' | 'text'> & Partial<Pick<Cue, 'id' | 'character' | 'direction'>>;
export interface KaraokeOptions {
  /** seconds before a cue starts that it is shown */
  lead?: number;
  tail?: number;
  showWho?: boolean;
  showDirection?: boolean;
  /** text shown when no cue is active (otherwise the element hides) */
  idle?: string | null;
}

/** Karaoke-style current line: words light up as their syllable time arrives. Used on video and on the TV party screens. */
export class Karaoke {
  readonly el: HTMLElement;
  readonly opts: Required<KaraokeOptions>;
  cue: KaraokeCue | null = null;
  spans: HTMLElement[] = [];
  words: WordTiming[] = [];
  cues: KaraokeCue[] | null = null;

  constructor(el: HTMLElement, { lead = 1.2, tail = 0.5, showWho = true, showDirection = true, idle = null }: KaraokeOptions = {}) {
    this.el = el;
    this.opts = { lead, tail, showWho, showDirection, idle };
  }
  /** override the cue source (party modes pass their own lines) */
  setCues(cues: KaraokeCue[] | null): void {
    this.cues = cues;
    this.cue = null;
  }
  update(now: number): void {
    const cues: KaraokeCue[] = this.cues || app.store.current?.cues || [];
    const cue = cues.find((c) => now >= c.start - this.opts.lead && now < c.end + this.opts.tail && c.text) || null;
    if (cue !== this.cue) {
      this.cue = cue;
      this.#render();
    }
    if (!cue) return;
    this.words.forEach((w, i) => {
      const s = this.spans[i];
      const done = now >= w.end;
      s.classList.toggle('done', done);
      s.classList.toggle('cur', now >= w.start && !done);
    });
  }
  #render() {
    clear(this.el);
    this.spans = [];
    this.words = [];
    const cue = this.cue;
    if (!cue) {
      if (this.opts.idle) {
        this.el.classList.remove('hidden');
        this.el.append(h('span.w', this.opts.idle));
      } else this.el.classList.add('hidden');
      return;
    }
    this.el.classList.remove('hidden');
    this.words = wordTimings(cue, detectLang(cue.text));
    if (this.opts.showWho && cue.character) this.el.append(h('span.who', cue.character));
    for (const w of this.words) {
      const s = h('span.w', w.text);
      this.spans.push(s);
      this.el.append(s);
    }
    if (this.opts.showDirection && cue.direction) this.el.append(h('span.direction', cue.direction));
  }
}
