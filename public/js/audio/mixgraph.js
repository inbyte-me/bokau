import { createFx, createMicFix, ensureWorklets } from './fx.js';
import { computeDuckCurve } from './duck.js';

/**
 * Builds the playback graph for any BaseAudioContext (live or offline). Single source of truth for the mix.
 *
 * assets: { orig, dialogue, bg: AudioBuffer|null, takes: Map<file,AudioBuffer>, envs: Map }
 * opts:
 *   from, to          timeline range in seconds
 *   when              ctx time at which `from` should sound
 *   include           { original, voices, ghost }
 *   voiceMode         'wet' (track chain: micFix + fx + vol/pan) | 'dry' (raw clips only)
 *   ducking           apply bg ducking to original
 *   levels            'mix' | 'stem'   (stem = post-fader but not ducked)
 *   muteOriginal      force original silent (e.g. while recording on speakers)
 *   destination       node to connect master to
 */
export async function buildMix(ctx, project, assets, opts) {
  const { from = 0, to = Infinity, when = ctx.currentTime + 0.05, include = { original: true, voices: true, ghost: false }, voiceMode = 'wet', ducking = true, destination } = opts;
  await ensureWorklets(ctx);
  const duration = Math.min(to, opts.totalDuration ?? Infinity) - from;
  const sources = []; const handle = { sources, nodes: {}, trackNodes: new Map(), stop() { for (const s of sources) { try { s.stop(); } catch {} } try { master.disconnect(); } catch {} } };

  const master = ctx.createGain(); handle.master = master;
  const limiter = ctx.createDynamicsCompressor(); // safety net, transparent below -2 dBFS
  limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.08;
  master.connect(limiter); if (destination) limiter.connect(destination); handle.out = limiter;

  const soloActive = project.original.solo || project.tracks.some((t) => t.solo);
  const audibleTrack = (t) => !t.mute && (!soloActive || t.solo);
  const audibleOrig = !project.original.mute && (!soloActive || project.original.solo) && !opts.muteOriginal;
  handle.audibleTrack = audibleTrack;

  // ---------- original (music/sfx/dialogue) ----------
  if (include.original && assets.orig) {
    const wantBg = project.original.source === 'bg' || (include.ghost && project.original.ghost.enabled);
    const wantDlg = project.original.source === 'dialogue';
    const buf = wantBg ? (assets.bg || (include.ghost && project.original.ghost.enabled ? null : assets.orig)) : wantDlg ? (assets.dialogue || assets.orig) : assets.orig;
    if (buf && audibleOrig) {
      const src = ctx.createBufferSource(); src.buffer = buf;
      const g = ctx.createGain(); g.gain.value = project.original.volume;
      const duck = ctx.createGain(); duck.gain.value = 1;
      src.connect(g); g.connect(duck); duck.connect(master);
      src.start(when, Math.min(from, buf.duration), Math.max(0, Math.min(duration, buf.duration - from)));
      sources.push(src); handle.nodes.origGain = g; handle.nodes.duck = duck; handle.nodes.liveDuck = duck;
      if (ducking && project.ducking.enabled && include.voices) {
        const d = computeDuckCurve(project, assets, { duration: assets.totalDuration ?? (from + duration), audibleTrack });
        const i0 = Math.max(0, Math.floor(from * d.rate));
        const slice = d.curve.slice(i0, Math.min(d.curve.length, i0 + Math.ceil(duration * d.rate) + 2));
        if (slice.length >= 2) { duck.gain.setValueAtTime(slice[0], when); duck.gain.setValueCurveAtTime(slice, when, Math.max(0.02, (slice.length - 1) / d.rate)); }
        handle.duckCurve = d;
      }
    }
  }

  // ---------- ghost guide (original dialogue -> one ear, low level) ----------
  if (include.ghost && project.original.ghost.enabled && assets.orig) {
    const buf = assets.dialogue || assets.orig;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = project.original.ghost.level;
    const pan = ctx.createStereoPanner(); pan.pan.value = project.original.ghost.pan;
    src.connect(g); g.connect(pan); pan.connect(destination || ctx.destination); // bypasses master/limiter on purpose (headphones only)
    src.start(when, Math.min(from, buf.duration), Math.max(0, Math.min(duration, buf.duration - from)));
    sources.push(src); handle.nodes.ghostGain = g; handle.nodes.ghostPan = pan;
  }

  // ---------- voice tracks ----------
  if (include.voices) {
    const voiceBus = ctx.createGain(); voiceBus.connect(master); handle.nodes.voiceBus = voiceBus;
    for (const t of project.tracks) {
      if (!audibleTrack(t) || !t.clips.length) continue;
      const tIn = ctx.createGain(); const tOut = ctx.createGain(); const pan = ctx.createStereoPanner();
      let fx = null;
      if (voiceMode === 'wet') {
        let prev = tIn;
        if (t.micFix) { const mf = createMicFix(ctx); prev.connect(mf.input); prev = mf.output; }
        fx = createFx(ctx, t.fx, t.fxAmount ?? 1);
        prev.connect(fx.input); fx.output.connect(tOut);
        tOut.gain.value = t.volume; pan.pan.value = t.pan || 0;
      } else { tIn.connect(tOut); tOut.gain.value = 1; pan.pan.value = 0; }
      tOut.connect(pan); pan.connect(voiceBus);
      handle.trackNodes.set(t.id, { tIn, tOut, pan, fx });
      const lat = fx?.latencySec || 0;
      for (const c of t.clips) {
        const buf = assets.takes.get(c.file); if (!buf) continue;
        const cs = c.start + (voiceMode === 'wet' ? (t.nudgeMs || 0) / 1000 : 0);
        const ce = cs + c.duration;
        if (ce <= from || cs >= from + duration) continue;
        let offset = c.offset, at = when + (cs - from) - lat, dur = c.duration;
        if (cs < from) { const skip = from - cs; offset += skip; dur -= skip; at = when - lat; }
        if (at < when - lat) at = when - lat;
        if (at < ctx.currentTime && !(ctx instanceof OfflineAudioContext)) { const late = ctx.currentTime - at; at = ctx.currentTime; offset += late; dur -= late; }
        if (at < 0) { offset += -at; dur -= -at; at = 0; }
        dur = Math.min(dur, from + duration - Math.max(cs, from));
        if (dur <= 0.001) continue;
        const src = ctx.createBufferSource(); src.buffer = buf;
        const cg = ctx.createGain(); const gain = (c.gain ?? 1);
        const fade = Math.min(0.008, dur / 4);
        cg.gain.setValueAtTime(0, at); cg.gain.linearRampToValueAtTime(gain, at + fade);
        cg.gain.setValueAtTime(gain, at + dur - fade); cg.gain.linearRampToValueAtTime(0, at + dur);
        src.connect(cg); cg.connect(tIn);
        src.start(at, offset, dur); sources.push(src);
        fx?.decorate(at + lat, dur);
      }
    }
  }

  /** live level changes without rebuilding */
  handle.applyLevels = (p) => {
    const now = ctx.currentTime;
    if (handle.nodes.origGain) handle.nodes.origGain.gain.setTargetAtTime(p.original.volume, now, 0.02);
    if (handle.nodes.ghostGain) handle.nodes.ghostGain.gain.setTargetAtTime(p.original.ghost.level, now, 0.02);
    if (handle.nodes.ghostPan) handle.nodes.ghostPan.pan.setTargetAtTime(p.original.ghost.pan, now, 0.02);
    for (const t of p.tracks) { const n = handle.trackNodes.get(t.id); if (n && voiceMode === 'wet') { n.tOut.gain.setTargetAtTime(t.volume, now, 0.02); n.pan.pan.setTargetAtTime(t.pan || 0, now, 0.02); } }
  };
  return handle;
}
