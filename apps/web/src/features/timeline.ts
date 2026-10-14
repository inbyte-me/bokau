import { drawWave } from '@doblaje/audio';
import { type Clip, type Cue, clamp, type Marker, newCue, newTrack, type Project, pickColor, type TimeRange, type Track } from '@doblaje/core';
import { t } from '@doblaje/ui';
import { app } from '../app.svelte.ts';
import { splitAtPlayhead } from './actions.ts';

const H = { ruler: 28, thumbs: 42, orig: 66, spk: 38, cues: 36, flaps: 22, track: 64 };
const HASH = (s: string) => {
  let x = 0;
  for (const c of s || '') x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return x;
};
/** A cue takes its character's colour (the same as that character's lane); unknown characters get a stable colour from the name. */
export const cueColor = (c: Pick<Cue, 'character'>): string => {
  if (!c.character) return '#e3b04b';
  const sp = app.store.current?.speakers.list.find((s) => s.name === c.character);
  return sp?.color || pickColor(HASH(c.character));
};

/**
 * Multi-lane timeline: ruler / video thumbnails / original audio / voices / cues / lip flaps / voice tracks.
 * One canvas for all lanes + a column of lane headers kept row-aligned (TimelineView.svelte).
 */
export type LaneKind = 'ruler' | 'thumbs' | 'orig' | 'speakers' | 'cues' | 'flaps' | 'track';
export interface Row {
  k: LaneKind;
  h: number;
  y: number;
  /** track id for 'track' lanes */
  id?: string;
}
/** The timeline's lanes, top to bottom, with their heights and positions (the canvas and the headers share them). */
export function lanes(p: Project): Row[] {
  const rows: Row[] = [
    { k: 'ruler', h: H.ruler, y: 0 },
    { k: 'thumbs', h: H.thumbs, y: 0 },
    { k: 'orig', h: H.orig, y: 0 },
  ];
  // one lane per identified character: their passages of the original dialogue
  if (p.speakers?.segments?.length) for (const sp of p.speakers.list) rows.push({ k: 'speakers', id: sp.id, h: H.spk, y: 0 });
  rows.push({ k: 'cues', h: H.cues, y: 0 }, { k: 'flaps', h: H.flaps, y: 0 });
  for (const tr of p.tracks) rows.push({ k: 'track', id: tr.id, h: H.track, y: 0 });
  let y = 0;
  for (const r of rows) {
    r.y = y;
    y += r.h;
  }
  return rows;
}

type Drag =
  | { type: 'scrub' }
  | { type: 'region'; a: number }
  | { type: 'cue-l' | 'cue-m' | 'cue-r'; cue: Cue; x0: number; s0: number; e0: number; before: Cue[]; moved: boolean }
  | { type: 'clip'; tr: Track; clip: Clip; x0: number; s0: number; moved: boolean }
  | { type: 'flap'; a: number; f: TimeRange };
export interface Hit {
  cue?: Cue;
  edge?: 'l' | 'm' | 'r';
  tr?: Track;
  clip?: Clip;
  flap?: TimeRange;
}

/** The elements a Timeline draws into (TimelineView.svelte renders them, with the toolbar and the lane headers). */
export interface TimelineElements {
  canvas: HTMLCanvasElement;
  /** the canvas's box: its width is the visible time span */
  wrap: HTMLElement;
  /** the time scrollbar and its thumb */
  sbar: HTMLElement;
  sbarThumb: HTMLElement;
}

/**
 * The timeline's canvas: lanes (ruler, video, original, voices, cues, lip flaps, tracks), drawing, pointer editing,
 * and the edit actions the keyboard and menus use. The markup around it (toolbar, lane headers) is TimelineView.svelte.
 */
export class Timeline {
  readonly dpr = window.devicePixelRatio || 1;
  drag: Drag | null = null;
  thumbImg: HTMLImageElement | 'loading' | null = null;
  dirty = true;
  totalH = 0;
  readonly canvas: HTMLCanvasElement;
  readonly wrap: HTMLElement;
  readonly sbar: HTMLElement;
  readonly sbarThumb: HTMLElement;
  readonly #ro: ResizeObserver;
  readonly #off: (() => void)[];
  #raf = 0;

  constructor({ canvas, wrap, sbar, sbarThumb }: TimelineElements) {
    this.canvas = canvas;
    this.wrap = wrap;
    this.sbar = sbar;
    this.sbarThumb = sbarThumb;
    this.#ro = new ResizeObserver(() => {
      this.#resize();
    });
    this.#ro.observe(this.wrap);
    this.#bind();
    this.rebuild();
    this.#off = [
      app.store.on('change', (k) => {
        if (k.has('tracks') || k.has('all') || k.has('media') || k.has('speakers')) this.rebuild();
        else this.invalidate();
      }),
      app.on('selection', () => {
        this.rebuild();
      }),
      app.engine.on('time', () => this.#followAndDraw()),
      app.engine.on('pause', () => this.invalidate()),
    ];
    const loop = () => {
      if (this.dirty) {
        this.dirty = false;
        this.draw();
      }
      this.#raf = requestAnimationFrame(loop);
    };
    loop();
  }
  destroy(): void {
    cancelAnimationFrame(this.#raf);
    this.#ro.disconnect();
    for (const f of this.#off) f();
  }
  invalidate(): void {
    this.dirty = true;
  }
  get p(): Project {
    return app.project;
  }
  get dur(): number {
    return app.engine.duration || this.p.media?.duration || 0;
  }
  get tracks(): Track[] {
    return this.p.tracks;
  }

  // ----- geometry -----
  layout(): Row[] {
    const rows = lanes(this.p);
    this.totalH = rows.reduce((h, r) => h + r.h, 0);
    return rows;
  }
  x2t(x: number): number {
    return app.view.t0 + x / app.view.pps;
  }
  t2x(t: number): number {
    return (t - app.view.t0) * app.view.pps;
  }
  get width() {
    return this.wrap.clientWidth;
  }
  setView(t0: number, pps: number): void {
    const min = Math.max(4, (this.width / Math.max(1, this.dur)) * 0.9),
      max = 1200;
    app.view.pps = clamp(pps, min, max);
    app.view.t0 = clamp(t0, 0, Math.max(0, this.dur - this.width / app.view.pps));
    this.invalidate();
    this.#sbar();
  }
  zoom(f: number, anchorX = this.width / 2): void {
    const ta = this.x2t(anchorX);
    const pps = app.view.pps * f;
    this.setView(ta - anchorX / clamp(pps, 4, 1200), pps);
  }
  fit(): void {
    this.setView(0, this.width / Math.max(1, this.dur));
  }
  #followAndDraw() {
    if (app.engine.playing && !this.drag) {
      const x = this.t2x(app.engine.time);
      if (x > this.width * 0.92 || x < 0) this.setView(app.engine.time - (this.width * 0.1) / app.view.pps, app.view.pps);
    }
    this.invalidate();
  }
  #sbar() {
    const i = this.sbarThumb;
    const vis = this.width / app.view.pps;
    const f = clamp(vis / this.dur, 0.02, 1);
    i.style.width = `${f * 100}%`;
    i.style.left = `${(app.view.t0 / this.dur) * 100}%`;
  }
  #resize() {
    const w = this.wrap.clientWidth;
    if (!w) return;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(this.totalH * this.dpr);
    this.canvas.style.height = `${this.totalH}px`;
    if (app.view.pps * this.dur < w) this.fit();
    this.#sbar();
    this.invalidate();
  }

  // ----- actions used by the toolbar and lane headers -----
  addTrack(): void {
    app.store.commit(
      'Add track',
      (p) => {
        const tr = newTrack({ name: `${t('Voice')} ${p.tracks.length + 1}`, index: p.tracks.length });
        p.tracks.push(tr);
        app.select({ trackId: tr.id });
      },
      ['tracks'],
    );
  }
  /** Lanes changed (tracks, voices, media): recompute their heights and redraw. */
  rebuild(): void {
    this.layout();
    this.#resize();
    this.invalidate();
  }
  tog(who: string, key: 'mute' | 'solo'): void {
    app.store.commit(
      'Mute/Solo',
      (p) => {
        const o = who === 'original' ? p.original : p.tracks.find((x) => x.id === who);
        if (o) o[key] = !o[key];
      },
      ['levels', 'tracks'],
    );
    void app.engine.refresh();
  }

  // ----- drawing -----
  #loadThumbs() {
    const m = this.p.media;
    if (this.thumbImg || !m?.thumbs) return;
    this.thumbImg = 'loading';
    const img = new Image();
    img.onload = () => {
      this.thumbImg = img;
      this.invalidate();
    };
    img.src = `/media/${this.p.id}/thumbs.jpg`;
  }
  draw(): void {
    if (!app.store.current) return;
    const rows = this.layout();
    const W = this.width;
    const c = this.canvas.getContext('2d');
    if (!W || !c) return;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, W, this.totalH);
    const { pps, t0 } = app.view;
    const t1 = t0 + W / pps;
    const p = this.p;
    const A = app.engine.assets;
    this.#loadThumbs();
    c.font = '11px ui-monospace, Menlo, monospace';
    c.textBaseline = 'middle';
    rows.forEach((r, i) => {
      c.fillStyle = i % 2 ? '#151514' : '#181817';
      c.fillRect(0, r.y, W, r.h);
      c.fillStyle = '#2e2d29';
      c.fillRect(0, r.y + r.h - 1, W, 1);
    });
    // grid
    const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 70) || 600;
    c.fillStyle = '#21211e';
    for (let s = Math.ceil(t0 / step) * step; s < t1; s += step) c.fillRect(this.t2x(s), H.ruler, 1, this.totalH - H.ruler);
    // ruler
    c.fillStyle = '#a8a59c';
    c.textAlign = 'left';
    for (let s = Math.ceil(t0 / step) * step; s < t1; s += step) {
      const x = this.t2x(s);
      c.fillRect(x, H.ruler - 8, 1, 8);
      c.fillText(fmtRuler(s, step), x + 4, 12);
    }
    c.font = 'bold 10px ui-monospace, Menlo, monospace';
    for (const m of p.markers || []) {
      const mx = this.t2x(m.t);
      if (mx < -20 || mx > W + 20) continue;
      c.fillStyle = 'rgba(255,200,87,.55)';
      c.fillRect(mx, 0, 1, this.totalH);
      c.fillStyle = '#ffc857';
      c.fillRect(mx, 0, 16, 13);
      c.beginPath();
      c.moveTo(mx + 16, 0);
      c.lineTo(mx + 21, 6.5);
      c.lineTo(mx + 16, 13);
      c.fill();
      c.fillStyle = '#1a1405';
      c.textAlign = 'left';
      c.fillText(String(m.n), mx + 4, 7);
    }
    c.font = '11px ui-monospace, Menlo, monospace';
    // loop / punch region
    const reg = app.sel.region || p.loop;
    if (reg) {
      const x0 = this.t2x(reg.start),
        x1 = this.t2x(reg.end);
      c.fillStyle = 'rgba(212,57,44,.13)';
      c.fillRect(x0, 0, x1 - x0, this.totalH);
      c.fillStyle = 'rgba(212,57,44,.9)';
      c.fillRect(x0, 0, x1 - x0, 3);
      c.fillRect(x0, 0, 2, this.totalH);
      c.fillRect(x1 - 2, 0, 2, this.totalH);
    }
    // thumbnails
    const th = rows[1];
    const T = p.media?.thumbs;
    if (T && this.thumbImg instanceof Image) {
      const tw = T.w * (th.h / T.h);
      const n = Math.ceil(W / tw) + 1;
      for (let k = 0; k < n; k++) {
        const x = k * tw;
        const tt = clamp(this.x2t(x + tw / 2), 0, this.dur - 0.01);
        const idx = Math.min(T.count - 1, Math.floor(tt / T.interval));
        c.drawImage(this.thumbImg, (idx % T.cols) * T.w, Math.floor(idx / T.cols) * T.h, T.w, T.h, x, th.y, tw + 1, th.h);
      }
      const xe = this.t2x(this.dur);
      if (xe < W) {
        c.fillStyle = '#0b0c0f';
        c.fillRect(xe, th.y, W - xe, th.h);
      }
    }
    // original waveform(s)
    const o = rows[2];
    if (A) {
      const stems = p.stems?.status === 'ready' && A.peaks.has('bg');
      const dim = p.original.mute ? 0.35 : 1;
      c.globalAlpha = dim;
      if (stems) {
        drawWave(c, A.peaks.get('bg'), { x0: 0, x1: W, y: o.y + 2, h: o.h / 2 - 2, t0, t1, color: '#6f8196' });
        drawWave(c, A.peaks.get('dialogue'), { x0: 0, x1: W, y: o.y + o.h / 2, h: o.h / 2 - 2, t0, t1, color: '#b49a7a' });
        c.fillStyle = '#8a877e';
        c.fillText(t('music+sfx'), 6, o.y + 8);
        c.fillText(t('dialogue'), 6, o.y + o.h / 2 + 8);
      } else drawWave(c, A.peaks.get('orig'), { x0: 0, x1: W, y: o.y + 2, h: o.h - 4, t0, t1, color: '#7f8a96' });
      c.globalAlpha = 1;
    }
    // one lane per character: their passages, with the dialogue waveform inside; silenced characters are hatched
    const spRows = rows.filter((r) => r.k === 'speakers');
    if (spRows.length) {
      const spk = p.speakers;
      const anySolo = spk.list.some((x) => x.solo);
      const dlg = A?.peaks.get('dialogue') || A?.peaks.get('orig');
      for (const sr of spRows) {
        const sp = spk.list.find((x) => x.id === sr.id);
        if (!sp) continue;
        const off = sp.muted || (anySolo && !sp.solo);
        spk.segments.forEach((g, gi) => {
          if (g.speaker !== sp.id || g.end < t0 || g.start > t1) return;
          const x0 = this.t2x(g.start);
          const x1 = this.t2x(g.end);
          const w = Math.max(2, x1 - x0);
          c.fillStyle = `${sp.color}${off ? '26' : '40'}`;
          c.fillRect(x0, sr.y + 3, w, sr.h - 6);
          c.save();
          c.beginPath();
          c.rect(x0, sr.y + 3, w, sr.h - 6);
          c.clip();
          if (dlg) drawWave(c, dlg, { x0, x1, y: sr.y + 4, h: sr.h - 8, t0: g.start, t1: g.end, color: off ? '#5a5853' : sp.color });
          if (off) {
            c.strokeStyle = 'rgba(235,233,228,.35)';
            c.lineWidth = 1;
            for (let hx = x0 - sr.h; hx < x1; hx += 6) {
              c.beginPath();
              c.moveTo(hx, sr.y + sr.h - 3);
              c.lineTo(hx + sr.h, sr.y + 3);
              c.stroke();
            }
          }
          c.restore();
          c.strokeStyle = app.sel.segIdx === gi ? '#fff' : sp.color;
          c.lineWidth = app.sel.segIdx === gi ? 1.5 : 1;
          c.strokeRect(x0 + 0.5, sr.y + 3.5, w - 1, sr.h - 7);
        });
      }
    }
    // cues
    const cr = rows.find((r) => r.k === 'cues') as Row;
    for (const cue of p.cues) {
      if (cue.end < t0 || cue.start > t1) continue;
      const x0 = this.t2x(cue.start),
        x1 = this.t2x(cue.end),
        col = cueColor(cue);
      const sel = app.sel.cueId === cue.id;
      c.fillStyle = `${col}${sel ? 'f0' : 'a0'}`;
      roundRect(c, x0, cr.y + 4, Math.max(3, x1 - x0), cr.h - 8, 5);
      c.fill();
      if (sel) {
        c.strokeStyle = '#fff';
        c.lineWidth = 1.5;
        c.stroke();
      }
      c.save();
      c.beginPath();
      c.rect(x0 + 3, cr.y, Math.max(0, x1 - x0 - 6), cr.h);
      c.clip();
      c.fillStyle = '#14110a';
      c.textAlign = 'left';
      c.fillText(`${cue.character ? `${cue.character}: ` : ''}${cue.text}`, x0 + 6, cr.y + cr.h / 2);
      c.restore();
    }
    // lip flaps
    const fl = rows.find((r) => r.k === 'flaps') as Row;
    c.fillStyle = '#cfc9b8';
    for (const f of p.lipFlaps) {
      if (f.end < t0 || f.start > t1) continue;
      roundRect(c, this.t2x(f.start), fl.y + 4, Math.max(2, this.t2x(f.end) - this.t2x(f.start)), fl.h - 8, 4);
      c.fill();
    }
    // tracks
    const soloAny = p.original.solo || p.tracks.some((x) => x.solo);
    rows
      .filter((r) => r.k === 'track')
      .forEach((r) => {
        const tr = p.tracks.find((x) => x.id === r.id);
        if (!tr) return;
        const live = !tr.mute && (!soloAny || tr.solo);
        c.globalAlpha = live ? 1 : 0.4;
        for (const clip of tr.clips) {
          const cs = clip.start + (tr.nudgeMs || 0) / 1000;
          const ce = cs + clip.duration;
          if (ce < t0 || cs > t1) continue;
          const x0 = this.t2x(cs),
            x1 = this.t2x(ce);
          const sel = app.sel.clipId === clip.id;
          c.fillStyle = `${tr.color}33`;
          roundRect(c, x0, r.y + 3, x1 - x0, r.h - 6, 6);
          c.fill();
          c.save();
          c.beginPath();
          c.rect(x0, r.y, x1 - x0, r.h);
          c.clip();
          const pk = A?.peaks.get(clip.file);
          if (pk)
            drawWave(c, pk, {
              x0,
              x1,
              y: r.y + 6,
              h: r.h - 12,
              t0: clip.offset + Math.max(0, t0 - cs),
              t1: clip.offset + Math.min(clip.duration, t1 - cs),
              color: tr.color,
              gain: Math.min(4, clip.gain ?? 1),
            });
          c.restore();
          c.strokeStyle = sel ? '#fff' : tr.color;
          c.lineWidth = sel ? 2 : 1;
          roundRect(c, x0, r.y + 3, x1 - x0, r.h - 6, 6);
          c.stroke();
        }
        c.globalAlpha = 1;
        const sr2 = app.sel.region;
        if (sr2 && app.sel.trackId === tr.id) {
          c.fillStyle = 'rgba(255,200,87,.12)';
          c.fillRect(this.t2x(sr2.start), r.y, this.t2x(sr2.end) - this.t2x(sr2.start), r.h);
        }
      });
    // ducking envelope overlay on the original lane
    const dc = app.engine.handle?.duckCurve;
    if (dc && p.ducking.enabled) {
      c.strokeStyle = 'rgba(235,233,228,.85)';
      c.lineWidth = 1.25;
      c.beginPath();
      let started = false;
      for (let x = 0; x < W; x += 2) {
        const i = Math.floor(this.x2t(x) * dc.rate);
        const g = dc.curve[i] ?? 1;
        const y = o.y + o.h - 4 - g * (o.h - 8);
        if (started) c.lineTo(x, y);
        else {
          c.moveTo(x, y);
          started = true;
        }
      }
      c.stroke();
    }
    // playhead
    const px = this.t2x(app.engine.time);
    if (px >= -1 && px <= W + 1) {
      c.fillStyle = '#e8473a';
      c.fillRect(px - 0.5, 0, 1.5, this.totalH);
      c.beginPath();
      c.moveTo(px - 6, 0);
      c.lineTo(px + 6, 0);
      c.lineTo(px, 9);
      c.fill();
    }
    // recording tint
    if (app.session.state === 'recording') {
      c.fillStyle = 'rgba(212,57,44,.07)';
      c.fillRect(0, 0, W, this.totalH);
    }
    this.#sbar();
  }

  // ----- interaction -----
  /** What is under a viewport point (for context menus): lane, timeline time and the thing hit there. */
  pick(clientX: number, clientY: number): { lane: LaneKind; trackId?: string; t: number; hit: Hit; marker?: Marker; segIdx: number | null } | null {
    const b = this.canvas.getBoundingClientRect();
    const x = clientX - b.left;
    const y = clientY - b.top;
    const r = this.#laneAt(y);
    if (!r) return null;
    const t = clamp(this.x2t(x), 0, this.dur);
    const marker = r.k === 'ruler' && y < 14 ? (this.p.markers || []).find((m) => x >= this.t2x(m.t) - 1 && x <= this.t2x(m.t) + 22) : undefined;
    const segIdx = r.k === 'speakers' ? this.p.speakers.segments.findIndex((g) => g.speaker === r.id && t >= g.start && t < g.end) : -1;
    return { lane: r.k, trackId: r.id, t, hit: this.#hit(r, x), marker, segIdx: segIdx >= 0 ? segIdx : null };
  }
  #laneAt(y: number): Row | undefined {
    return this.layout().find((r) => y >= r.y && y < r.y + r.h);
  }
  #hit(r: Row, x: number): Hit {
    const p = this.p;
    const tt = this.x2t(x);
    if (r.k === 'cues')
      for (const cue of [...p.cues].reverse()) {
        const a = this.t2x(cue.start),
          b = this.t2x(cue.end);
        if (x >= a - 3 && x <= b + 3) return { cue, edge: Math.abs(x - a) < 6 ? 'l' : Math.abs(x - b) < 6 ? 'r' : 'm' };
      }
    if (r.k === 'track') {
      const tr = p.tracks.find((q) => q.id === r.id);
      if (!tr) return {};
      for (const clip of [...tr.clips].reverse()) {
        const cs = clip.start + (tr.nudgeMs || 0) / 1000;
        if (tt >= cs && tt <= cs + clip.duration) return { tr, clip };
      }
      return { tr };
    }
    if (r.k === 'flaps') {
      const f = p.lipFlaps.find((q) => tt >= q.start && tt <= q.end);
      return { flap: f };
    }
    return {};
  }
  #bind() {
    const cv = this.canvas;
    const pos = (e: MouseEvent) => {
      const b = cv.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const { x } = pos(e);
        if (e.ctrlKey || e.metaKey) this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, x);
        else this.setView(app.view.t0 + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / app.view.pps, app.view.pps);
      },
      { passive: false },
    );
    cv.addEventListener('pointerdown', (e) => {
      (document.activeElement as HTMLElement | null)?.blur?.(); // keyboard shortcuts (Delete, Ctrl+Z…) must act on the timeline, not on a text box
      cv.setPointerCapture(e.pointerId);
      const { x, y } = pos(e);
      const r = this.#laneAt(y);
      if (!r) return;
      const tt = clamp(this.x2t(x), 0, this.dur);
      const p = this.p;
      const hit = this.#hit(r, x);
      if (r.k === 'ruler') {
        const fm = (p.markers || []).find((m) => x >= this.t2x(m.t) - 1 && x <= this.t2x(m.t) + 22 && y < 14);
        if (fm) {
          app.emit('jump-mark', fm.n);
          return;
        }
      }
      if (r.k === 'ruler' || r.k === 'thumbs') {
        if (e.shiftKey) {
          this.drag = { type: 'region', a: tt };
          app.sel.region = { start: tt, end: tt };
        } else {
          this.drag = { type: 'scrub' };
          app.engine.seek(tt);
        }
        return;
      }
      if (e.shiftKey && (r.k === 'track' || r.k === 'orig')) {
        this.drag = { type: 'region', a: tt };
        app.sel.region = { start: tt, end: tt };
        if (r.k === 'track') app.select({ trackId: r.id });
        return;
      }
      if (r.k === 'speakers') {
        const gi = p.speakers.segments.findIndex((g) => g.speaker === r.id && tt >= g.start && tt < g.end);
        app.select({ segIdx: gi >= 0 ? gi : null });
        app.engine.seek(tt);
        return;
      }
      if (r.k === 'cues') {
        if (hit.cue) {
          app.select({ cueId: hit.cue.id, clipId: null });
          this.drag = {
            type: `cue-${hit.edge || 'm'}`,
            cue: hit.cue,
            x0: x,
            s0: hit.cue.start,
            e0: hit.cue.end,
            before: structuredClone(p.cues),
            moved: false,
          };
        } else {
          app.select({ cueId: null });
          app.engine.seek(tt);
        }
        this.invalidate();
        return;
      }
      if (r.k === 'flaps') {
        const fl = hit.flap;
        if (fl) {
          app.store.commit(
            'Remove lip flap',
            (pr) => {
              pr.lipFlaps = pr.lipFlaps.filter((f) => f !== fl && !(f.start === fl.start && f.end === fl.end));
            },
            ['flaps'],
          );
        } else this.drag = { type: 'flap', a: tt, f: { start: tt, end: tt } };
        return;
      }
      if (r.k === 'track') {
        app.select({ trackId: r.id, clipId: hit.clip?.id || null, cueId: null });
        if (hit.clip && hit.tr) {
          this.drag = { type: 'clip', tr: hit.tr, clip: hit.clip, x0: x, s0: hit.clip.start, moved: false };
        } else {
          app.engine.seek(tt);
        }
        this.invalidate();
        return;
      }
      app.engine.seek(tt);
    });
    cv.addEventListener('pointermove', (e) => {
      const { x, y } = pos(e);
      const d = this.drag;
      const r = this.#laneAt(y);
      if (!d) {
        const hit = r?.k === 'cues' ? this.#hit(r, x) : null;
        cv.style.cursor = hit?.cue ? (hit.edge === 'm' ? 'grab' : 'ew-resize') : r?.k === 'ruler' ? 'col-resize' : 'default';
        return;
      }
      const tt = clamp(this.x2t(x), 0, this.dur);
      if (d.type === 'scrub') app.engine.seek(tt);
      else if (d.type === 'region') {
        app.sel.region = { start: Math.min(d.a, tt), end: Math.max(d.a, tt) };
        this.invalidate();
        app.emit('selection', app.sel);
      } else if (d.type === 'cue-l' || d.type === 'cue-m' || d.type === 'cue-r') {
        d.moved = true;
        const dt = (x - d.x0) / app.view.pps;
        const c = d.cue;
        if (d.type === 'cue-m') {
          const len = d.e0 - d.s0;
          c.start = clamp(d.s0 + dt, 0, this.dur - len);
          c.end = c.start + len;
        } else if (d.type === 'cue-l') c.start = clamp(d.s0 + dt, 0, c.end - 0.1);
        else c.end = clamp(d.e0 + dt, c.start + 0.1, this.dur);
        this.invalidate();
        app.emit('cues-live');
      } else if (d.type === 'clip') {
        d.moved = true;
        d.clip.start = Math.max(0, d.s0 + (x - d.x0) / app.view.pps);
        this.invalidate();
      } else if (d.type === 'flap') {
        d.f.end = tt;
        this.invalidate();
      }
    });
    const up = () => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if ((d.type === 'cue-l' || d.type === 'cue-m' || d.type === 'cue-r') && d.moved) {
        const after = structuredClone(app.project.cues);
        app.store.commit(
          'Edit cue',
          (pr) => {
            pr.cues.splice(0, pr.cues.length, ...after);
          },
          ['cues'],
        );
        const last = app.store.undoStack.at(-1);
        if (last) last.before.cues = d.before;
      }
      if (d.type === 'clip' && d.moved) {
        const ns = d.clip.start;
        d.clip.start = d.s0;
        app.store.commit('Move clip', () => {
          d.clip.start = ns;
        }, ['tracks']);
        void app.engine.refresh();
      }
      if (d.type === 'flap' && Math.abs(d.f.end - d.f.start) > 0.05) {
        const f = { start: Math.min(d.f.start, d.f.end), end: Math.max(d.f.start, d.f.end) };
        app.store.commit(
          'Add lip flap',
          (pr) => {
            pr.lipFlaps.push(f);
            pr.lipFlaps.sort((a, b) => a.start - b.start);
          },
          ['flaps'],
        );
      }
      if (d.type === 'region') {
        if (app.sel.region && app.sel.region.end - app.sel.region.start < 0.1) app.sel.region = null;
        app.emit('selection', app.sel);
      }
      this.invalidate();
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', (e) => {
      const { x, y } = pos(e);
      const r = this.#laneAt(y);
      if (r?.k !== 'cues') return;
      if (this.#hit(r, x).cue) return;
      const s = clamp(this.x2t(x), 0, this.dur - 0.5);
      const cue = newCue({ start: s, end: Math.min(this.dur, s + 1.8), text: t('New line') });
      app.store.commit(
        'Add cue',
        (p) => {
          p.cues.push(cue);
          p.cues.sort((a, b) => a.start - b.start);
        },
        ['cues'],
      );
      app.select({ cueId: cue.id });
      app.emit('focus-cue', cue.id);
    });
    this.sbar.addEventListener('pointerdown', (e) => {
      const f = (ev: PointerEvent) => {
        const b = this.sbar.getBoundingClientRect();
        this.setView(((ev.clientX - b.left) / b.width) * this.dur - this.width / app.view.pps / 2, app.view.pps);
      };
      f(e);
      const mv = (ev: PointerEvent) => f(ev);
      const upx = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', upx);
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', upx);
    });
  }

  // ----- actions -----
  /** S / the Split button: see splitAtPlayhead() in actions.ts. */
  splitAtPlayhead(): boolean {
    return splitAtPlayhead();
  }
  deleteSelected(): boolean {
    if (app.sel.clipId) {
      const id = app.sel.clipId;
      app.store.commit(
        'Delete clip',
        (p) => {
          for (const tr of p.tracks) tr.clips = tr.clips.filter((c) => c.id !== id);
        },
        ['tracks'],
      );
      app.select({ clipId: null });
      void app.engine.refresh();
      return true;
    }
    if (app.sel.cueId) {
      const id = app.sel.cueId;
      app.store.commit(
        'Delete cue',
        (p) => {
          p.cues = p.cues.filter((c) => c.id !== id);
        },
        ['cues'],
      );
      app.select({ cueId: null });
      return true;
    }
    return false;
  }
  loopFromSelection(): void {
    const cue = app.project.cues.find((c) => c.id === app.sel.cueId);
    const region: TimeRange | null = app.sel.region || (cue ? { start: cue.start, end: cue.end } : null);
    if (!region) {
      app.store.commit(
        'Loop',
        (p) => {
          p.loop = null;
        },
        ['loop'],
      );
      app.emit('toast', t('Select a cue or Shift+drag a range first'));
      return;
    }
    app.store.commit(
      'Loop',
      (p) => {
        p.loop = p.loop && Math.abs(p.loop.start - region.start) < 0.01 ? null : { start: region.start, end: region.end };
      },
      ['loop'],
    );
    this.invalidate();
  }
}

function fmtRuler(s: number, step: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return step < 1 ? `${m}:${sec.toFixed(2).padStart(5, '0')}` : `${m}:${String(Math.floor(sec)).padStart(2, '0')}`;
}
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.min(radius, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
