import { maskCurve, type Project, silencedRanges, type Track } from '@doblaje/core';
import type { MixAssets } from './assets.ts';
import { computeDuckCurve, type DuckCurve } from './duck.ts';
import { createFx, createMicFix, ensureWorklets, type FxChain } from './fx.ts';

export interface MixInclude {
  original: boolean;
  voices: boolean;
  ghost: boolean;
}
export interface MixOptions {
  /** timeline range in seconds */
  from?: number;
  to?: number;
  /** ctx time at which `from` should sound */
  when?: number;
  include?: MixInclude;
  /** 'wet' = track chain (mic fix + fx + volume/pan); 'dry' = raw clips only */
  voiceMode?: 'wet' | 'dry';
  /** apply look-ahead ducking of the original under the voices */
  ducking?: boolean;
  /** force the original silent (e.g. while recording on speakers) */
  muteOriginal?: boolean;
  destination?: AudioNode;
  totalDuration?: number;
}
export interface TrackNodes {
  tIn: GainNode;
  tOut: GainNode;
  pan: StereoPannerNode;
  fx: FxChain | null;
}
export interface MixHandle {
  sources: AudioScheduledSourceNode[];
  master: GainNode;
  out: AudioNode;
  nodes: {
    origGain?: GainNode;
    duck?: GainNode;
    liveDuck?: GainNode;
    voiceMask?: GainNode;
    ghostGain?: GainNode;
    ghostPan?: StereoPannerNode;
    voiceBus?: GainNode;
  };
  trackNodes: Map<string, TrackNodes>;
  duckCurve?: DuckCurve;
  audibleTrack: (t: Track) => boolean;
  stop(): void;
  /** live level changes without rebuilding */
  applyLevels(p: Project): void;
}

/**
 * Builds the playback graph for any BaseAudioContext (live or offline). Single source of truth for the mix:
 * preview and export run this same function, so what you hear is what you export.
 */
export async function buildMix(ctx: BaseAudioContext, project: Project, assets: MixAssets, opts: MixOptions): Promise<MixHandle> {
  const {
    from = 0,
    to = Number.POSITIVE_INFINITY,
    when = ctx.currentTime + 0.05,
    include = { original: true, voices: true, ghost: false },
    voiceMode = 'wet',
    ducking = true,
    destination,
  } = opts;
  await ensureWorklets(ctx);
  const duration = Math.min(to, opts.totalDuration ?? Number.POSITIVE_INFINITY) - from;
  const sources: AudioScheduledSourceNode[] = [];
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor(); // safety net, transparent below -2 dBFS
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;
  master.connect(limiter);
  if (destination) limiter.connect(destination);

  const soloActive = project.original.solo || project.tracks.some((t) => t.solo);
  const audibleTrack = (t: Track) => !t.mute && (!soloActive || t.solo);
  const audibleOrig = !project.original.mute && (!soloActive || project.original.solo) && !opts.muteOriginal;
  const isOffline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;

  const handle: MixHandle = {
    sources,
    master,
    out: limiter,
    nodes: {},
    trackNodes: new Map(),
    audibleTrack,
    stop() {
      for (const s of sources) {
        try {
          s.stop();
        } catch {}
      }
      try {
        master.disconnect();
      } catch {}
    },
    applyLevels(p) {
      const now = ctx.currentTime;
      handle.nodes.origGain?.gain.setTargetAtTime(p.original.volume, now, 0.02);
      handle.nodes.ghostGain?.gain.setTargetAtTime(p.original.ghost.level, now, 0.02);
      handle.nodes.ghostPan?.pan.setTargetAtTime(p.original.ghost.pan, now, 0.02);
      if (voiceMode !== 'wet') return;
      for (const t of p.tracks) {
        const n = handle.trackNodes.get(t.id);
        if (!n) continue;
        n.tOut.gain.setTargetAtTime(t.volume, now, 0.02);
        n.pan.pan.setTargetAtTime(t.pan || 0, now, 0.02);
      }
    },
  };

  // ---------- original (music/sfx/dialogue) ----------
  // With separated stems, "full" plays music + dialogue as two layers so individual voices can be silenced.
  if (include.original && assets.orig) {
    const ghostOn = include.ghost && project.original.ghost.enabled;
    const source = project.original.source;
    const spk = project.speakers || { list: [], segments: [] };
    const silenced = [...silencedRanges(spk.list, spk.segments), ...(project.dubbed || [])];
    let parts: { buf: AudioBuffer; masked?: boolean }[];
    if (source === 'bg' || ghostOn) parts = assets.bg ? [{ buf: assets.bg }] : ghostOn ? [] : [{ buf: assets.orig }];
    else if (source === 'dialogue') parts = [{ buf: assets.dialogue || assets.orig, masked: !!assets.dialogue }];
    else if (assets.bg && assets.dialogue && silenced.length) parts = [{ buf: assets.bg }, { buf: assets.dialogue, masked: true }];
    else parts = [{ buf: assets.orig }];
    if (parts.length && audibleOrig) {
      const g = ctx.createGain();
      g.gain.value = project.original.volume;
      const duck = ctx.createGain();
      duck.gain.value = 1;
      const liveDuck = ctx.createGain(); // driven by the live mic while recording
      liveDuck.gain.value = 1;
      g.connect(duck);
      duck.connect(liveDuck);
      liveDuck.connect(master);
      for (const part of parts) {
        const src = ctx.createBufferSource();
        src.buffer = part.buf;
        if (part.masked && silenced.length) {
          const mg = ctx.createGain();
          const curve = maskCurve(silenced, from, duration);
          mg.gain.setValueAtTime(curve[0], when);
          mg.gain.setValueCurveAtTime(curve, when, Math.max(0.02, (curve.length - 1) / 200));
          src.connect(mg);
          mg.connect(g);
          handle.nodes.voiceMask = mg;
        } else src.connect(g);
        src.start(when, Math.min(from, part.buf.duration), Math.max(0, Math.min(duration, part.buf.duration - from)));
        sources.push(src);
      }
      Object.assign(handle.nodes, { origGain: g, duck, liveDuck });
      if (ducking && project.ducking.enabled && include.voices) {
        const d = computeDuckCurve(project, assets, { duration: assets.totalDuration ?? from + duration, audibleTrack });
        const i0 = Math.max(0, Math.floor(from * d.rate));
        const slice = d.curve.slice(i0, Math.min(d.curve.length, i0 + Math.ceil(duration * d.rate) + 2));
        if (slice.length >= 2) {
          duck.gain.setValueAtTime(slice[0], when);
          duck.gain.setValueCurveAtTime(slice, when, Math.max(0.02, (slice.length - 1) / d.rate));
        }
        handle.duckCurve = d;
      }
    }
  }

  // ---------- ghost guide (original dialogue -> one ear, low level) ----------
  if (include.ghost && project.original.ghost.enabled && assets.orig) {
    const buf = assets.dialogue || assets.orig;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = project.original.ghost.level;
    const pan = ctx.createStereoPanner();
    pan.pan.value = project.original.ghost.pan;
    src.connect(g);
    g.connect(pan);
    pan.connect(destination || ctx.destination); // bypasses master/limiter on purpose (headphones only)
    src.start(when, Math.min(from, buf.duration), Math.max(0, Math.min(duration, buf.duration - from)));
    sources.push(src);
    handle.nodes.ghostGain = g;
    handle.nodes.ghostPan = pan;
  }

  // ---------- voice tracks ----------
  if (include.voices) {
    const voiceBus = ctx.createGain();
    voiceBus.connect(master);
    handle.nodes.voiceBus = voiceBus;
    for (const t of project.tracks) {
      if (!audibleTrack(t) || !t.clips.length) continue;
      const tIn = ctx.createGain();
      const tOut = ctx.createGain();
      const pan = ctx.createStereoPanner();
      let fx: FxChain | null = null;
      if (voiceMode === 'wet') {
        let prev: AudioNode = tIn;
        if (t.micFix) {
          const mf = createMicFix(ctx);
          prev.connect(mf.input);
          prev = mf.output;
        }
        fx = createFx(ctx, t.fx, t.fxAmount ?? 1);
        prev.connect(fx.input);
        fx.output.connect(tOut);
        tOut.gain.value = t.volume;
        pan.pan.value = t.pan || 0;
      } else {
        tIn.connect(tOut);
        tOut.gain.value = 1;
        pan.pan.value = 0;
      }
      tOut.connect(pan);
      pan.connect(voiceBus);
      handle.trackNodes.set(t.id, { tIn, tOut, pan, fx });
      const lat = fx?.latencySec || 0;
      for (const c of t.clips) {
        const buf = assets.takes.get(c.file);
        if (!buf) continue;
        const cs = c.start + (voiceMode === 'wet' ? (t.nudgeMs || 0) / 1000 : 0);
        const ce = cs + c.duration;
        if (ce <= from || cs >= from + duration) continue;
        let offset = c.offset;
        let at = when + (cs - from) - lat;
        let dur = c.duration;
        if (cs < from) {
          const skip = from - cs;
          offset += skip;
          dur -= skip;
          at = when - lat;
        }
        if (at < when - lat) at = when - lat;
        if (at < ctx.currentTime && !isOffline) {
          const late = ctx.currentTime - at;
          at = ctx.currentTime;
          offset += late;
          dur -= late;
        }
        if (at < 0) {
          offset += -at;
          dur -= -at;
          at = 0;
        }
        dur = Math.min(dur, from + duration - Math.max(cs, from));
        if (dur <= 0.001) continue;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const cg = ctx.createGain();
        const gain = c.gain ?? 1;
        const fade = Math.min(0.008, dur / 4);
        cg.gain.setValueAtTime(0, at);
        cg.gain.linearRampToValueAtTime(gain, at + fade);
        cg.gain.setValueAtTime(gain, at + dur - fade);
        cg.gain.linearRampToValueAtTime(0, at + dur);
        src.connect(cg);
        cg.connect(tIn);
        src.start(at, offset, dur);
        sources.push(src);
        fx?.decorate(at + lat, dur);
      }
    }
  }
  return handle;
}
