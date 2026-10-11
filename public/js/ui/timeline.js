import { h, clamp, clear } from '../util.js';
import { t } from '../i18n.js';
import { app } from '../app.js';
import { drawWave } from '../audio/peaks.js';
import { FX_INFO } from '../audio/fx.js';
import { newCue, newId, newTrack, pickColor, carveClips } from '/shared/project.js';

const H = { ruler: 28, thumbs: 48, orig: 74, cues: 40, flaps: 24, track: 70 };
const HASH = (s) => { let x = 0; for (const c of s || '') x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
export const cueColor = (c) => (c.character ? pickColor(HASH(c.character)) : '#ffd166');

/**
 * Multi-lane timeline: ruler / video thumbnails / original audio / cues / lip-flap / voice tracks.
 * One canvas for all lanes + a DOM column of lane headers kept row-aligned.
 */
export class Timeline {
  constructor(root) {
    this.root = root; this.dpr = window.devicePixelRatio || 1; this.drag = null; this.thumbImg = null; this.hover = null; this.dirty = true;
    this.heads = h('div.tl-heads'); this.canvas = h('canvas.tl', { id: 'timeline-canvas' });
    this.wrap = h('div.tl-canvas-wrap', this.canvas);
    this.scroll = h('div.tl-scroll', h('div.tl-inner', this.heads, this.wrap));
    this.sbar = h('div.tl-scrollbar', h('i')); this.toolbar = this.#toolbar();
    root.append(this.toolbar, this.scroll, this.sbar);
    this.ro = new ResizeObserver(() => { this.#resize(); }); this.ro.observe(this.wrap);
    this.#bind(); this.rebuild();
    this.off = [
      app.store.on('change', (k) => { if (k.has('tracks') || k.has('all') || k.has('media')) this.rebuild(); else this.invalidate(); }),
      app.on('selection', () => { this.rebuild(); }),
      app.engine.on('time', () => this.#followAndDraw()), app.engine.on('pause', () => this.invalidate()),
    ];
    const loop = () => { if (this.dirty) { this.dirty = false; this.draw(); } this.raf = requestAnimationFrame(loop); }; loop();
  }
  destroy() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.off.forEach((f) => f()); }
  invalidate() { this.dirty = true; }
  get p() { return app.project; }
  get dur() { return app.engine.duration || this.p.media.duration; }
  get tracks() { return this.p.tracks; }

  // ----- geometry -----
  layout() {
    const rows = [{ k: 'ruler', h: H.ruler }, { k: 'thumbs', h: H.thumbs }, { k: 'orig', h: H.orig }, { k: 'cues', h: H.cues }, { k: 'flaps', h: H.flaps }];
    for (const tr of this.tracks) rows.push({ k: 'track', id: tr.id, h: H.track });
    let y = 0; for (const r of rows) { r.y = y; y += r.h; } this.totalH = y; return rows;
  }
  x2t(x) { return app.view.t0 + x / app.view.pps; }
  t2x(t) { return (t - app.view.t0) * app.view.pps; }
  get width() { return this.wrap.clientWidth; }
  setView(t0, pps) {
    const min = Math.max(4, this.width / Math.max(1, this.dur) * 0.9), max = 1200;
    app.view.pps = clamp(pps, min, max);
    app.view.t0 = clamp(t0, 0, Math.max(0, this.dur - this.width / app.view.pps));
    this.invalidate(); this.#sbar();
  }
  zoom(f, anchorX = this.width / 2) { const ta = this.x2t(anchorX); const pps = app.view.pps * f; this.setView(ta - anchorX / clamp(pps, 4, 1200), pps); }
  fit() { this.setView(0, this.width / Math.max(1, this.dur)); }
  #followAndDraw() {
    if (app.engine.playing && !this.drag) { const x = this.t2x(app.engine.time); if (x > this.width * 0.92 || x < 0) this.setView(app.engine.time - this.width * 0.1 / app.view.pps, app.view.pps); }
    this.invalidate();
  }
  #sbar() {
    const i = this.sbar.firstChild; const vis = this.width / app.view.pps; const f = clamp(vis / this.dur, 0.02, 1);
    i.style.width = `${f * 100}%`; i.style.left = `${(app.view.t0 / this.dur) * 100}%`;
  }
  #resize() {
    const w = this.wrap.clientWidth; if (!w) return; this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(this.totalH * this.dpr); this.canvas.style.height = this.totalH + 'px';
    if (app.view.pps * this.dur < w) this.fit(); this.#sbar(); this.invalidate();
  }

  // ----- toolbar + headers -----
  #toolbar() {
    const b = (label, fn, title, id) => h('button.icon', { title, id, onclick: fn }, label);
    return h('div.tl-toolbar', b('－', () => this.zoom(0.7), t('Zoom out (-)')), b('＋', () => this.zoom(1.4), t('Zoom in (+)')), b('⤢', () => this.fit(), t('Fit to window')),
      h('div.sep'), b('＋ ' + t('Voice track'), () => this.addTrack(), t('Add a voice track (another character or take lane)'), 'add-track'),
      b('✂ ' + t('Split'), () => this.splitAtPlayhead(), t('Split the selected clip at the playhead (S)'), 'split-btn'),
      b('🗑', () => this.deleteSelected(), t('Delete selected clip / cue (Del)'), 'del-btn'),
      h('div.sep'), b('⟲ ' + t('Loop'), () => this.loopFromSelection(), t('Loop the selected cue or the dragged range (L)'), 'loop-btn'),
      h('span.hint', { style: { marginLeft: '.6rem' } }, t('Drag the ruler to scrub · Shift+drag to set a punch/loop range · Ctrl+wheel to zoom')));
  }
  addTrack() { app.store.commit('Add track', (p) => { const tr = newTrack({ name: `${t('Voice')} ${p.tracks.length + 1}`, index: p.tracks.length }); p.tracks.push(tr); app.select({ trackId: tr.id }); }, ['tracks']); }
  rebuild() {
    const rows = this.layout(); clear(this.heads);
    const p = this.p; const soloAny = p.original.solo || p.tracks.some((x) => x.solo);
    for (const r of rows) {
      const hd = h('div.tl-head', { style: { height: r.h + 'px' } });
      if (r.k === 'ruler') hd.append(h('div.small.dim', t('Timeline')), h('div.mono.small.dim', `${p.media.width}×${p.media.height} · ${p.media.fps}fps`));
      else if (r.k === 'thumbs') hd.append(h('div.name', '🎞 ' + t('Video')));
      else if (r.k === 'orig') {
        const o = p.original; const stems = p.stems?.status === 'ready';
        hd.append(h('div.name', '🔊 ' + t('Original audio') + (stems ? ' ✂' : '')),
          h('div.btns', h('button' + (o.mute ? '.on' : ''), { title: t('Mute original'), onclick: () => this.tog('original', 'mute') }, 'M'), h('button' + (o.solo ? '.on' : ''), { title: t('Solo original'), onclick: () => this.tog('original', 'solo') }, 'S'),
            h('input', { type: 'range', min: 0, max: 1.5, step: 0.01, value: o.volume, title: t('Original volume'), oninput: (e) => { app.store.silent((pr) => { pr.original.volume = +e.target.value; }, ['levels']); app.engine.applyLevels(); }, onchange: () => app.store.commit('Original volume', () => {}, ['levels'], { merge: true }) })),
          stems ? h('select', { title: t('Which part of the original to play'), onchange: (e) => { app.store.commit('Original source', (pr) => { pr.original.source = e.target.value; }, ['levels']); app.engine.refresh(); } },
            ...[['full', t('Full mix')], ['bg', t('Music + SFX only')], ['dialogue', t('Dialogue only')]].map(([v, l]) => h('option', { value: v, selected: o.source === v }, l))) : null);
      } else if (r.k === 'cues') hd.append(h('div.name', '💬 ' + t('Cue lane')), h('div.small.dim', t('Double-click to add')));
      else if (r.k === 'flaps') hd.append(h('div.name', '👄 ' + t('Lip flaps')), h('div.small.dim', t('Drag to draw mouth-open')));
      else {
        const tr = p.tracks.find((x) => x.id === r.id); const sel = app.sel.trackId === tr.id || (!app.sel.trackId && tr === p.tracks[0]);
        hd.classList.toggle('sel', sel); hd.dataset.track = tr.id;
        const audible = !tr.mute && (!soloAny || tr.solo);
        hd.style.opacity = audible ? 1 : 0.55;
        hd.onclick = () => app.select({ trackId: tr.id });
        hd.append(h('div.name', h('span.swatch', { style: { background: tr.color } }), h('input.nm', { value: tr.name, title: t('Rename'), onchange: (e) => app.store.commit('Rename track', () => { tr.name = e.target.value; }, ['tracks']), onclick: (e) => e.stopPropagation() })),
          h('div.btns', h('button' + (tr.mute ? '.on' : ''), { title: t('Mute'), onclick: (e) => { e.stopPropagation(); this.tog(tr.id, 'mute'); } }, 'M'), h('button' + (tr.solo ? '.on' : ''), { title: t('Solo'), onclick: (e) => { e.stopPropagation(); this.tog(tr.id, 'solo'); } }, 'S'),
            h('input', { type: 'range', min: 0, max: 1.6, step: 0.01, value: tr.volume, title: t('Track volume'), onclick: (e) => e.stopPropagation(), oninput: (e) => { tr.volume = +e.target.value; app.engine.applyLevels(); app.store.silent(() => {}, ['levels']); }, onchange: () => app.store.commit('Track volume', () => {}, ['levels'], { merge: true }) }),
            p.tracks.length > 1 ? h('button.ghost', { title: t('Remove track'), onclick: (e) => { e.stopPropagation(); if (!tr.clips.length || confirm(t('Remove this track and its clips?'))) app.store.commit('Remove track', (pr) => { pr.tracks = pr.tracks.filter((x) => x.id !== tr.id); }, ['tracks']); } }, '✕') : null),
          h('select', { title: t('Voice effect'), onclick: (e) => e.stopPropagation(), onchange: (e) => { app.store.commit('Voice effect', () => { tr.fx = e.target.value; }, ['tracks']); app.engine.refresh(); } },
            ...Object.entries(FX_INFO).map(([k, v]) => h('option', { value: k, selected: tr.fx === k }, `${v.emoji} ${t(v.label)}`))));
      }
      this.heads.append(hd);
    }
    this.#resize(); this.invalidate();
  }
  tog(who, key) {
    app.store.commit('Mute/Solo', (p) => { const o = who === 'original' ? p.original : p.tracks.find((x) => x.id === who); o[key] = !o[key]; }, ['levels', 'tracks']);
    app.engine.refresh();
  }

  // ----- drawing -----
  async #loadThumbs() {
    const m = this.p.media; if (this.thumbImg || !m.thumbs) return;
    this.thumbImg = 'loading'; const img = new Image(); img.onload = () => { this.thumbImg = img; this.invalidate(); }; img.src = `/media/${this.p.id}/thumbs.jpg`;
  }
  draw() {
    if (!this.p) return; const rows = this.layout(); const W = this.width; if (!W) return;
    const c = this.canvas.getContext('2d'); c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, W, this.totalH);
    const { pps, t0 } = app.view; const t1 = t0 + W / pps; const p = this.p; const A = app.engine.assets;
    this.#loadThumbs();
    c.font = '11px ui-monospace, Menlo, monospace'; c.textBaseline = 'middle';
    rows.forEach((r, i) => { c.fillStyle = i % 2 ? '#15161a' : '#18191e'; c.fillRect(0, r.y, W, r.h); c.fillStyle = '#2a2d36'; c.fillRect(0, r.y + r.h - 1, W, 1); });
    // grid
    const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 70) || 600;
    c.fillStyle = '#20222a'; for (let s = Math.ceil(t0 / step) * step; s < t1; s += step) c.fillRect(this.t2x(s), H.ruler, 1, this.totalH - H.ruler);
    // ruler
    c.fillStyle = '#8c93a3'; c.textAlign = 'left';
    for (let s = Math.ceil(t0 / step) * step; s < t1; s += step) { const x = this.t2x(s); c.fillRect(x, H.ruler - 8, 1, 8); c.fillText(fmtRuler(s, step), x + 4, 12); }
    for (const m of p.markers || []) { c.fillStyle = '#ffc857'; c.fillRect(this.t2x(m.t), 0, 1, H.ruler); }
    // loop / punch region
    const reg = app.sel.region || p.loop;
    if (reg) { const x0 = this.t2x(reg.start), x1 = this.t2x(reg.end); c.fillStyle = 'rgba(255,90,79,.14)'; c.fillRect(x0, 0, x1 - x0, this.totalH); c.fillStyle = 'rgba(255,90,79,.8)'; c.fillRect(x0, 0, x1 - x0, 3); c.fillRect(x0, 0, 2, this.totalH); c.fillRect(x1 - 2, 0, 2, this.totalH); }
    // thumbnails
    const th = rows[1]; const T = p.media.thumbs;
    if (T && this.thumbImg instanceof Image) {
      const tw = T.w * (th.h / T.h); const n = Math.ceil(W / tw) + 1;
      for (let k = 0; k < n; k++) {
        const x = k * tw; const tt = clamp(this.x2t(x + tw / 2), 0, this.dur - 0.01); const idx = Math.min(T.count - 1, Math.floor(tt / T.interval));
        c.drawImage(this.thumbImg, (idx % T.cols) * T.w, Math.floor(idx / T.cols) * T.h, T.w, T.h, x, th.y, tw + 1, th.h);
      }
      const xe = this.t2x(this.dur); if (xe < W) { c.fillStyle = '#0b0c0f'; c.fillRect(xe, th.y, W - xe, th.h); }
    }
    // original waveform(s)
    const o = rows[2];
    if (A) {
      const stems = p.stems?.status === 'ready' && A.peaks.get('bg');
      const dim = p.original.mute ? 0.35 : 1;
      c.globalAlpha = dim;
      if (stems) { drawWave(c, A.peaks.get('bg'), { x0: 0, x1: W, y: o.y + 2, h: o.h / 2 - 2, t0, t1, color: '#4f86c9' }); drawWave(c, A.peaks.get('dialogue'), { x0: 0, x1: W, y: o.y + o.h / 2, h: o.h / 2 - 2, t0, t1, color: '#e9965a' }); c.fillStyle = '#7d8498'; c.fillText(t('music+sfx'), 6, o.y + 8); c.fillText(t('dialogue'), 6, o.y + o.h / 2 + 8); }
      else drawWave(c, A.peaks.get('orig'), { x0: 0, x1: W, y: o.y + 2, h: o.h - 4, t0, t1, color: '#5f93d0' });
      // ducking preview
      if (p.ducking.enabled && app.engine.handle?.duckCurve) { /* drawn below */ }
      c.globalAlpha = 1;
    }
    // cues
    const cr = rows[3];
    for (const cue of p.cues) {
      if (cue.end < t0 || cue.start > t1) continue;
      const x0 = this.t2x(cue.start), x1 = this.t2x(cue.end), col = cueColor(cue); const sel = app.sel.cueId === cue.id;
      c.fillStyle = col + (sel ? 'ee' : '99'); roundRect(c, x0, cr.y + 4, Math.max(3, x1 - x0), cr.h - 8, 5); c.fill();
      if (sel) { c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke(); }
      c.save(); c.beginPath(); c.rect(x0 + 3, cr.y, Math.max(0, x1 - x0 - 6), cr.h); c.clip(); c.fillStyle = '#111'; c.textAlign = 'left'; c.fillText((cue.character ? cue.character + ': ' : '') + cue.text, x0 + 6, cr.y + cr.h / 2); c.restore();
    }
    // lip flaps
    const fl = rows[4]; c.fillStyle = '#ff8fb8';
    for (const f of p.lipFlaps) { if (f.end < t0 || f.start > t1) continue; roundRect(c, this.t2x(f.start), fl.y + 4, Math.max(2, this.t2x(f.end) - this.t2x(f.start)), fl.h - 8, 4); c.fill(); }
    // tracks
    const soloAny = p.original.solo || p.tracks.some((x) => x.solo);
    rows.filter((r) => r.k === 'track').forEach((r) => {
      const tr = p.tracks.find((x) => x.id === r.id); const live = !tr.mute && (!soloAny || tr.solo); c.globalAlpha = live ? 1 : 0.4;
      for (const clip of tr.clips) {
        const cs = clip.start + (tr.nudgeMs || 0) / 1000; const ce = cs + clip.duration; if (ce < t0 || cs > t1) continue;
        const x0 = this.t2x(cs), x1 = this.t2x(ce); const sel = app.sel.clipId === clip.id;
        c.fillStyle = tr.color + '33'; roundRect(c, x0, r.y + 3, x1 - x0, r.h - 6, 6); c.fill();
        c.save(); c.beginPath(); c.rect(x0, r.y, x1 - x0, r.h); c.clip();
        const pk = A?.peaks.get(clip.file); if (pk) drawWave(c, pk, { x0, x1, y: r.y + 6, h: r.h - 12, t0: clip.offset + Math.max(0, t0 - cs), t1: clip.offset + Math.min(clip.duration, t1 - cs), color: tr.color, gain: Math.min(4, clip.gain ?? 1) });
        c.restore(); c.strokeStyle = sel ? '#fff' : tr.color; c.lineWidth = sel ? 2 : 1; roundRect(c, x0, r.y + 3, x1 - x0, r.h - 6, 6); c.stroke();
      }
      c.globalAlpha = 1;
      if (app.sel.region && app.sel.trackId === tr.id) { c.fillStyle = 'rgba(255,200,87,.12)'; c.fillRect(this.t2x(app.sel.region.start), r.y, this.t2x(app.sel.region.end) - this.t2x(app.sel.region.start), r.h); }
    });
    // ducking envelope overlay on the original lane
    const dc = app.engine.handle?.duckCurve;
    if (dc && p.ducking.enabled) { c.strokeStyle = 'rgba(61,220,192,.9)'; c.lineWidth = 1.5; c.beginPath(); let started = false; for (let x = 0; x < W; x += 2) { const i = Math.floor(this.x2t(x) * dc.rate); const g = dc.curve[i] ?? 1; const y = o.y + o.h - 4 - g * (o.h - 8); started ? c.lineTo(x, y) : (c.moveTo(x, y), started = true); } c.stroke(); }
    // playhead
    const px = this.t2x(app.engine.time); if (px >= -1 && px <= W + 1) { c.fillStyle = '#ff3b30'; c.fillRect(px - 0.5, 0, 1.5, this.totalH); c.beginPath(); c.moveTo(px - 6, 0); c.lineTo(px + 6, 0); c.lineTo(px, 9); c.fill(); }
    // recording tint
    if (app.session.state === 'recording') { c.fillStyle = 'rgba(255,59,48,.07)'; c.fillRect(0, 0, W, this.totalH); }
    this.#sbar();
  }

  // ----- interaction -----
  #laneAt(y) { return this.layout().find((r) => y >= r.y && y < r.y + r.h); }
  #hit(r, x) {
    const p = this.p; const tt = this.x2t(x);
    if (r.k === 'cues') for (const cue of [...p.cues].reverse()) { const a = this.t2x(cue.start), b = this.t2x(cue.end); if (x >= a - 3 && x <= b + 3) return { cue, edge: Math.abs(x - a) < 6 ? 'l' : Math.abs(x - b) < 6 ? 'r' : 'm' }; }
    if (r.k === 'track') { const tr = p.tracks.find((q) => q.id === r.id); for (const clip of [...tr.clips].reverse()) { const cs = clip.start + (tr.nudgeMs || 0) / 1000; if (tt >= cs && tt <= cs + clip.duration) return { tr, clip }; } return { tr }; }
    if (r.k === 'flaps') { const f = p.lipFlaps.find((q) => tt >= q.start && tt <= q.end); return { flap: f }; }
    return {};
  }
  #bind() {
    const cv = this.canvas;
    const pos = (e) => { const b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    cv.addEventListener('wheel', (e) => {
      e.preventDefault(); const { x } = pos(e);
      if (e.ctrlKey || e.metaKey) this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, x);
      else this.setView(app.view.t0 + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / app.view.pps, app.view.pps);
    }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId); const { x, y } = pos(e); const r = this.#laneAt(y); if (!r) return; const tt = clamp(this.x2t(x), 0, this.dur); const p = this.p; const hit = this.#hit(r, x);
      if (r.k === 'ruler' || r.k === 'thumbs') { if (e.shiftKey) { this.drag = { type: 'region', a: tt }; app.sel.region = { start: tt, end: tt }; } else { this.drag = { type: 'scrub' }; app.engine.seek(tt); } return; }
      if (e.shiftKey && (r.k === 'track' || r.k === 'orig')) { this.drag = { type: 'region', a: tt }; app.sel.region = { start: tt, end: tt }; if (r.k === 'track') app.select({ trackId: r.id }); return; }
      if (r.k === 'cues') {
        if (hit.cue) { app.select({ cueId: hit.cue.id, clipId: null }); this.drag = { type: 'cue-' + hit.edge, cue: hit.cue, x0: x, s0: hit.cue.start, e0: hit.cue.end, before: structuredClone(p.cues), moved: false }; }
        else { app.select({ cueId: null }); app.engine.seek(tt); }
        this.invalidate(); return;
      }
      if (r.k === 'flaps') { if (hit.flap) { app.store.commit('Remove lip flap', (pr) => { pr.lipFlaps = pr.lipFlaps.filter((f) => f !== hit.flap && !(f.start === hit.flap.start && f.end === hit.flap.end)); }, ['flaps']); } else this.drag = { type: 'flap', a: tt, f: { start: tt, end: tt } }; return; }
      if (r.k === 'track') {
        app.select({ trackId: r.id, clipId: hit.clip?.id || null, cueId: null });
        if (hit.clip) { this.drag = { type: 'clip', tr: hit.tr, clip: hit.clip, x0: x, s0: hit.clip.start, moved: false }; } else { app.engine.seek(tt); }
        this.invalidate(); return;
      }
      app.engine.seek(tt);
    });
    cv.addEventListener('pointermove', (e) => {
      const { x, y } = pos(e); const d = this.drag; const r = this.#laneAt(y);
      if (!d) { const hit = r?.k === 'cues' ? this.#hit(r, x) : null; cv.style.cursor = hit?.cue ? (hit.edge === 'm' ? 'grab' : 'ew-resize') : r?.k === 'ruler' ? 'col-resize' : 'default'; return; }
      const tt = clamp(this.x2t(x), 0, this.dur);
      if (d.type === 'scrub') app.engine.seek(tt);
      else if (d.type === 'region') { app.sel.region = { start: Math.min(d.a, tt), end: Math.max(d.a, tt) }; this.invalidate(); app.emit('selection', app.sel); }
      else if (d.type.startsWith('cue-')) {
        d.moved = true; const dt = (x - d.x0) / app.view.pps; const c = d.cue;
        if (d.type === 'cue-m') { const len = d.e0 - d.s0; c.start = clamp(d.s0 + dt, 0, this.dur - len); c.end = c.start + len; } else if (d.type === 'cue-l') c.start = clamp(d.s0 + dt, 0, c.end - 0.1); else c.end = clamp(d.e0 + dt, c.start + 0.1, this.dur);
        this.invalidate(); app.emit('cues-live');
      } else if (d.type === 'clip') { d.moved = true; d.clip.start = Math.max(0, d.s0 + (x - d.x0) / app.view.pps); this.invalidate(); }
      else if (d.type === 'flap') { d.f.end = tt; d.cur = d.f; this.invalidate(); }
    });
    const up = () => {
      const d = this.drag; this.drag = null; if (!d) return;
      if (d.type.startsWith('cue-') && d.moved) { const after = structuredClone(app.project.cues); app.store.commit('Edit cue', (pr) => { pr.cues.splice(0, pr.cues.length, ...after); }, ['cues']); app.store.undoStack.at(-1).before.cues = d.before; }
      if (d.type === 'clip' && d.moved) { const ns = d.clip.start; d.clip.start = d.s0; app.store.commit('Move clip', () => { d.clip.start = ns; }, ['tracks']); app.engine.refresh(); }
      if (d.type === 'flap' && Math.abs(d.f.end - d.f.start) > 0.05) { const f = { start: Math.min(d.f.start, d.f.end), end: Math.max(d.f.start, d.f.end) }; app.store.commit('Add lip flap', (pr) => { pr.lipFlaps.push(f); pr.lipFlaps.sort((a, b) => a.start - b.start); }, ['flaps']); }
      if (d.type === 'region') { if (app.sel.region && app.sel.region.end - app.sel.region.start < 0.1) app.sel.region = null; app.emit('selection', app.sel); }
      this.invalidate();
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', (e) => {
      const { x, y } = pos(e); const r = this.#laneAt(y); if (r?.k !== 'cues') return;
      if (this.#hit(r, x).cue) return;
      const s = clamp(this.x2t(x), 0, this.dur - 0.5); const cue = newCue({ start: s, end: Math.min(this.dur, s + 1.8), text: t('New line') });
      app.store.commit('Add cue', (p) => { p.cues.push(cue); p.cues.sort((a, b) => a.start - b.start); }, ['cues']); app.select({ cueId: cue.id });
      app.emit('focus-cue', cue.id);
    });
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); app.sel.region = null; this.invalidate(); app.emit('selection', app.sel); });
    this.sbar.addEventListener('pointerdown', (e) => {
      const f = (ev) => { const b = this.sbar.getBoundingClientRect(); this.setView(((ev.clientX - b.left) / b.width) * this.dur - (this.width / app.view.pps) / 2, app.view.pps); };
      f(e); const mv = (ev) => f(ev); const upx = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upx); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upx);
    });
  }

  // ----- actions -----
  splitAtPlayhead() {
    const tt = app.engine.time; const tr = app.track; const clip = tr.clips.find((c) => tt > c.start + 0.02 && tt < c.start + c.duration - 0.02);
    if (!clip) return false;
    app.store.commit('Split clip', () => {
      const cut = tt - clip.start; const right = { ...clip, id: newId('c'), start: tt, offset: clip.offset + cut, duration: clip.duration - cut };
      clip.duration = cut; tr.clips.push(right); tr.clips.sort((a, b) => a.start - b.start);
    }, ['tracks']); app.engine.refresh(); return true;
  }
  deleteSelected() {
    if (app.sel.clipId) { const id = app.sel.clipId; app.store.commit('Delete clip', (p) => { for (const tr of p.tracks) tr.clips = tr.clips.filter((c) => c.id !== id); }, ['tracks']); app.select({ clipId: null }); app.engine.refresh(); return true; }
    if (app.sel.cueId) { const id = app.sel.cueId; app.store.commit('Delete cue', (p) => { p.cues = p.cues.filter((c) => c.id !== id); }, ['cues']); app.select({ cueId: null }); return true; }
    return false;
  }
  loopFromSelection() {
    const cue = app.project.cues.find((c) => c.id === app.sel.cueId);
    const region = app.sel.region || (cue && { start: cue.start, end: cue.end });
    if (!region) { app.store.commit('Loop', (p) => { p.loop = null; }, ['loop']); app.emit('toast', t('Select a cue or Shift+drag a range first')); return; }
    app.store.commit('Loop', (p) => { p.loop = p.loop && Math.abs(p.loop.start - region.start) < 0.01 ? null : { start: region.start, end: region.end }; }, ['loop']); this.invalidate();
  }
}

function fmtRuler(s, step) { const m = Math.floor(s / 60); const sec = s - m * 60; return step < 1 ? `${m}:${sec.toFixed(2).padStart(5, '0')}` : `${m}:${String(Math.floor(sec)).padStart(2, '0')}`; }
function roundRect(c, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
