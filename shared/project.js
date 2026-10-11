// Project model shared by server and browser. Plain JSON, non-destructive:
// recordings are immutable files; clips only reference (file, offset, duration).

export const PROJECT_VERSION = 1;
export const MODES = ['pro', 'party'];
export const FX_PRESETS = ['none', 'walkie', 'monster', 'helium', 'ghost'];

export function newId(prefix = 'x') {
  const r = (globalThis.crypto?.randomUUID?.() || Math.random().toString(16).slice(2) + Date.now().toString(16)).replace(/-/g, '');
  return prefix + r.slice(0, 8);
}

export function defaultProject({ id, name = 'Untitled', mode = 'pro' } = {}) {
  return {
    version: PROJECT_VERSION,
    id, name, mode,
    party: { sub: null },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    media: null, // filled by ingest: {duration,width,height,fps,hasVideo,hasAudio,...}
    stems: { status: 'none', method: null }, // none | ready
    cues: [],
    lipFlaps: [], // [{start,end}] mouth-open intervals
    original: { volume: 1, mute: false, solo: false, source: 'full', ghost: { enabled: false, level: 0.25, pan: -1 } },
    ducking: { enabled: true, db: -12, attack: 0.04, release: 0.35, threshold: 0.02 },
    latencyMs: 0,
    tracks: [newTrack({ name: 'Voice 1' })],
    loop: null, // {start,end}
    settings: { preRoll: 3, preRollBeep: true, monitor: false, muteOriginalWhileRecording: false, output: 'headphones' },
    markers: [],
  };
}

export function newTrack(o = {}) {
  return { id: newId('t'), name: 'Voice', kind: 'voice', color: pickColor(o.index || 0), volume: 1, pan: 0, mute: false, solo: false, fx: 'none', fxAmount: 1, micFix: true, nudgeMs: 0, clips: [], takes: [], ...o };
}
export function newCue(o = {}) {
  return { id: newId('c'), start: 0, end: 1, text: '', character: '', note: '', ...o };
}

const COLORS = ['#ff6b6b', '#4dd4ac', '#ffd166', '#6aa6ff', '#c792ea', '#ff9f68', '#7bdff2', '#f78fb3'];
export function pickColor(i) { return COLORS[i % COLORS.length]; }

/**
 * Overwrite a time range on a track: existing clips are trimmed/split around [start,end].
 * Nothing is deleted from disk; takes remain available.
 */
export function carveClips(clips, start, end) {
  const out = [];
  for (const c of clips) {
    const cs = c.start, ce = c.start + c.duration;
    if (ce <= start || cs >= end) { out.push(c); continue; }
    if (cs < start) out.push({ ...c, id: newId('k'), duration: start - cs });
    if (ce > end) out.push({ ...c, id: newId('k'), start: end, offset: c.offset + (end - cs), duration: ce - end });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function projectDuration(p) {
  let d = p.media?.duration || 0;
  for (const t of p.tracks) for (const c of t.clips) d = Math.max(d, c.start + c.duration);
  return d;
}

/** Fill defaults for older/partial project files. */
export function migrate(p) {
  const d = defaultProject({ id: p.id, name: p.name, mode: p.mode });
  const out = { ...d, ...p };
  out.original = { ...d.original, ...p.original, ghost: { ...d.original.ghost, ...p.original?.ghost } };
  out.ducking = { ...d.ducking, ...p.ducking };
  out.settings = { ...d.settings, ...p.settings };
  out.party = { ...d.party, ...p.party };
  out.tracks = (p.tracks?.length ? p.tracks : d.tracks).map((t, i) => ({ ...newTrack({ index: i }), ...t, clips: t.clips || [], takes: t.takes || [] }));
  out.version = PROJECT_VERSION;
  return out;
}
