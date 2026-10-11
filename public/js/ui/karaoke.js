import { h, clear } from '../util.js';
import { app } from '../app.js';
import { wordTimings, detectLang } from '/shared/syllables.js';

/** Karaoke-style current line: words light up as their syllable time arrives. Used on video and on the TV party screens. */
export class Karaoke {
  constructor(el, { lead = 1.2, tail = 0.5, showWho = true, showDirection = true, idle = null } = {}) { this.el = el; this.opts = { lead, tail, showWho, showDirection, idle }; this.cue = null; this.spans = []; this.words = []; this.mode = 'project'; this.cues = null; }
  /** override the cue source (party modes pass their own lines) */
  setCues(cues) { this.cues = cues; this.cue = null; }
  update(now) {
    const cues = this.cues || app.project?.cues || [];
    let cue = cues.find((c) => now >= c.start - this.opts.lead && now < c.end + this.opts.tail && c.text);
    if (cue && !(now >= cue.start - this.opts.lead)) cue = null;
    if (cue !== this.cue) { this.cue = cue; this.#render(); }
    if (cue) this.words.forEach((w, i) => { const s = this.spans[i]; const done = now >= w.end, cur = now >= w.start && !done; s.classList.toggle('done', done); s.classList.toggle('cur', cur); });
  }
  #render() {
    clear(this.el); this.spans = []; this.words = [];
    if (!this.cue) { if (this.opts.idle) { this.el.classList.remove('hidden'); this.el.append(h('span.w', this.opts.idle)); } else this.el.classList.add('hidden'); return; }
    this.el.classList.remove('hidden');
    this.words = wordTimings(this.cue, detectLang(this.cue.text));
    if (this.opts.showWho && this.cue.character) this.el.append(h('span.who', this.cue.character));
    this.words.forEach((w) => { const s = h('span.w', w.text); this.spans.push(s); this.el.append(s); });
    if (this.opts.showDirection && this.cue.direction) this.el.append(h('span.direction', this.cue.direction));
  }
}
