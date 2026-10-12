import { type Cue, detectLang, type WordTiming, wordTimings } from '@doblaje/core';
import { app } from '../app.ts';
import { cueColor } from './timeline.ts';
/**
 * "Bande rythmée": text scrolls right -> left towards the red indicator line, like a real dubbing studio.
 * Each word occupies the time span of its syllables (words stretch/shrink with syllable duration),
 * M/B/P letters (lips closed) are highlighted, and mouth-open intervals are drawn underneath.
 */
export class RhythmBand {
  readonly cv: HTMLCanvasElement;
  readonly dpr = window.devicePixelRatio || 1;
  /** pixels per second of the scrolling text */
  pps = Number(localStorage.getItem('bandPps')) || 190;
  /** where the red line sits, as a fraction of the width */
  readonly lineFrac = 0.24;
  W = 0;
  H = 0;
  #raf = 0;
  readonly #ro: ResizeObserver;
  readonly #cache = new Map<string, WordTiming[]>();

  constructor(canvas: HTMLCanvasElement) {
    this.cv = canvas;
    this.#ro = new ResizeObserver(() => this.#size());
    this.#ro.observe(canvas);
    this.#size();
    const loop = () => {
      this.draw();
      this.#raf = requestAnimationFrame(loop);
    };
    loop();
  }
  destroy(): void {
    cancelAnimationFrame(this.#raf);
    this.#ro.disconnect();
  }
  setSpeed(pps: number): void {
    this.pps = pps;
    try {
      localStorage.setItem('bandPps', String(pps));
    } catch {}
  }
  #size() {
    const b = this.cv.getBoundingClientRect();
    this.cv.width = Math.round(b.width * this.dpr);
    this.cv.height = Math.round(b.height * this.dpr);
    this.W = b.width;
    this.H = b.height;
  }
  words(cue: Cue): WordTiming[] {
    const key = `${cue.id}|${cue.text}|${cue.start}|${cue.end}`;
    let w = this.#cache.get(key);
    if (!w) {
      w = wordTimings(cue, detectLang(cue.text || ''));
      this.#cache.set(key, w);
      if (this.#cache.size > 400) this.#cache.delete(this.#cache.keys().next().value as string);
    }
    return w;
  }
  draw(): void {
    const p = app.store.current;
    const c = this.cv.getContext('2d');
    if (!p || !this.W || !c) return;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const W = this.W,
      H = this.H,
      now = app.engine.time,
      lineX = W * this.lineFrac,
      pps = this.pps;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#0b0b0a';
    c.fillRect(0, 0, W, H);
    const x = (t: number) => lineX + (t - now) * pps;
    const tMin = now - lineX / pps - 1,
      tMax = now + (W - lineX) / pps + 1;
    const top = H * 0.2,
      bandH = H * 0.5,
      flapY = H * 0.78,
      flapH = H * 0.14;
    // faint beat ticks every 0.5 s
    c.fillStyle = '#171715';
    for (let s = Math.ceil(tMin * 2) / 2; s < tMax; s += 0.5) c.fillRect(x(s), 0, 1, H);
    c.textBaseline = 'middle';
    for (const cue of p.cues) {
      if (cue.end < tMin || cue.start > tMax) continue;
      const col = cueColor(cue);
      const ws = this.words(cue);
      const x0 = x(cue.start),
        x1 = x(cue.end);
      c.fillStyle = '#1b1b19';
      rr(c, x0, top, x1 - x0, bandH, 8);
      c.fill();
      c.fillStyle = col;
      c.fillRect(x0 + 2, top, Math.max(2, x1 - x0 - 4), 3);
      if (cue.character) {
        c.font = `700 ${Math.max(10, H * 0.1)}px system-ui`;
        c.fillStyle = col;
        c.textAlign = 'left';
        c.fillText(cue.character.toUpperCase(), Math.max(x0 + 4, 2), top - H * 0.08);
      }
      for (const w of ws) {
        const a = x(w.start),
          b = x(w.end),
          width = b - a;
        if (b < 0 || a > W) continue;
        const state = now >= w.end ? 'past' : now >= w.start ? 'cur' : 'next';
        if (state === 'cur') {
          c.fillStyle = 'rgba(227,176,75,.22)';
          rr(c, a + 1, top + 4, width - 2, bandH - 8, 6);
          c.fill();
        }
        // syllable ticks
        if (w.syl > 1) {
          c.fillStyle = 'rgba(255,255,255,.12)';
          for (let k = 1; k < w.syl; k++) c.fillRect(a + (width * k) / w.syl, top + bandH - 8, 1, 6);
        }
        const fs = Math.min(H * 0.3, 34);
        c.font = `700 ${fs}px system-ui`;
        const nat = c.measureText(w.text).width;
        const avail = Math.max(4, width - 6);
        const sx = Math.max(0.45, Math.min(1.9, avail / nat)); // stretch/squeeze to the syllable duration
        c.save();
        c.beginPath();
        c.rect(a + 1, top, width - 2, bandH);
        c.clip();
        c.translate(a + 3, top + bandH / 2 + 1);
        c.scale(sx, 1);
        c.textAlign = 'left';
        let cx = 0;
        const base = state === 'past' ? '#6e6c64' : '#ffffff';
        for (let i = 0; i < w.text.length; i++) {
          const ch = w.text[i];
          c.fillStyle = w.bilabial.includes(i) ? (state === 'past' ? '#8c7544' : '#e3b04b') : base;
          c.fillText(ch, cx, 0);
          cx += c.measureText(ch).width;
        }
        c.restore();
      }
    }
    // mouth-open intervals
    c.fillStyle = '#141412';
    c.fillRect(0, flapY, W, flapH);
    c.fillStyle = '#cfc9b8';
    let open = false;
    for (const f of p.lipFlaps) {
      if (f.end < tMin || f.start > tMax) continue;
      rr(c, x(f.start), flapY + 1, Math.max(2, x(f.end) - x(f.start)), flapH - 2, 4);
      c.fill();
      if (now >= f.start && now <= f.end) open = true;
    }
    // indicator line
    c.fillStyle = '#e8473a';
    c.fillRect(lineX - 1.5, 0, 3, H);
    c.beginPath();
    c.moveTo(lineX - 7, 0);
    c.lineTo(lineX + 7, 0);
    c.lineTo(lineX, 9);
    c.fill();
    // mouth glyph
    const mx = lineX + 26,
      my = H * 0.1;
    c.fillStyle = open ? '#cfc9b8' : '#4a4944';
    c.beginPath();
    c.ellipse(mx, my, 11, open ? 6 : 1.6, 0, 0, Math.PI * 2);
    c.fill();
    if (app.session.state === 'recording') {
      c.fillStyle = '#e8473a';
      c.beginPath();
      c.arc(W - 14, 14, 5, 0, Math.PI * 2);
      c.fill();
    }
  }
}
function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.min(radius, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
