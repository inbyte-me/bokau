// Project model shared by server and browser. Plain JSON, non-destructive:
// recordings are immutable files; clips only reference (file, offset, duration).

export const PROJECT_VERSION = 1;
export const MODES = ['pro', 'party', 'podcast'] as const;
export type Mode = (typeof MODES)[number];
export const FX_PRESETS = ['none', 'walkie', 'monster', 'helium', 'ghost'] as const;
export type FxPreset = (typeof FX_PRESETS)[number];

export const isMode = (m: unknown): m is Mode => MODES.includes(m as Mode);

export interface TimeRange {
  start: number;
  end: number;
}

export interface Thumbs {
  file: string;
  count: number;
  interval: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
}

/** What ffprobe told us about a source file. */
export interface ProbeInfo {
  duration: number;
  container?: string;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  fps: number;
  vcodec: string | null;
  pixFmt: string | null;
  vbitrate: number;
  acodec: string | null;
  channels: number;
  channelLayout: string | null;
  sampleRate: number;
  bitrate: number;
  size: number;
}

/** Filled by ingest; server-owned. */
export interface Media extends ProbeInfo {
  ready: boolean;
  proxy: string;
  audio: string;
  audioStt: string | null;
  sourceFile: string;
  thumbs: Thumbs;
  ingestedAt: string;
}

export type StemMethod = 'surround-center' | 'stereo-center-cut' | 'neural-demucs';
export interface StereoSpread {
  midDb: number;
  sideDb: number;
  relDb: number;
}
/** Server-owned. */
export interface Stems {
  status: 'none' | 'ready' | 'unsupported';
  method: StemMethod | null;
  spread?: StereoSpread | null;
  reason?: string;
  neuralAvailable?: boolean;
  createdAt?: string;
}

export interface Cue extends TimeRange {
  id: string;
  text: string;
  character: string;
  note: string;
  direction?: string;
  snapped?: boolean;
  /** text before the first AI rewrite */
  orig?: string;
}

export interface Clip {
  id: string;
  file: string;
  /** timeline position (s) */
  start: number;
  /** offset into the take file (s) */
  offset: number;
  duration: number;
  gain?: number;
  takeId?: string;
}

export interface Take {
  id: string;
  file: string;
  start: number;
  duration: number;
  createdAt?: string;
  label?: string;
  [extra: string]: unknown;
}

export interface Track {
  id: string;
  name: string;
  kind: 'voice';
  color: string;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  fx: FxPreset;
  fxAmount: number;
  micFix: boolean;
  nudgeMs: number;
  clips: Clip[];
  takes: Take[];
  player?: string;
  index?: number;
}

export interface Speaker {
  id: string;
  name: string;
  color: string;
  muted: boolean;
  solo: boolean;
}
export interface SpeakerSegment extends TimeRange {
  speaker: string;
}

/** A numbered mark set with Cmd/Ctrl+number and recalled with Alt/Option+number. */
export interface Marker {
  id: string;
  n: number;
  t: number;
  /** optional label shown in the Marks list and on the ruler tooltip */
  name?: string;
}

export interface Chapter {
  t: number;
  title: string;
}

export interface PodcastSettings {
  trim: TimeRange | null;
  chapters: Chapter[];
  clean: { rumble: boolean; denoise: boolean; compress: boolean };
  loudnorm: boolean;
  format: 'mp3' | 'm4a' | 'wav' | 'mp4' | 'webm';
}

export interface Project {
  version: number;
  id: string;
  name: string;
  mode: Mode;
  party: { sub: string | null; [k: string]: unknown };
  createdAt: string;
  updatedAt: string;
  media: Media | null;
  stems: Stems;
  cues: Cue[];
  /** mouth-open intervals */
  lipFlaps: TimeRange[];
  original: {
    volume: number;
    mute: boolean;
    solo: boolean;
    source: 'full' | 'bg' | 'dialogue';
    ghost: { enabled: boolean; level: number; pan: number };
  };
  ducking: { enabled: boolean; db: number; attack: number; release: number; threshold: number };
  latencyMs: number;
  avOffsetMs?: number;
  tracks: Track[];
  loop: TimeRange | null;
  settings: {
    preRoll: number;
    preRollBeep: boolean;
    monitor: boolean;
    muteOriginalWhileRecording: boolean;
    output: 'headphones' | 'speakers';
    [k: string]: unknown;
  };
  speakers: { list: Speaker[]; segments: SpeakerSegment[] };
  markers: Marker[];
  podcast: PodcastSettings;
  /** a clip in the library (prepared once, never recorded on); projects are derived from it */
  template: boolean;
  /** the library clip a project was derived from */
  sourceTemplateId: string | null;
}

/** The part of a project the client may change; media, stems and library links are server-owned. */
export type EditableProject = Omit<Project, 'media' | 'stems' | 'id' | 'createdAt' | 'template' | 'sourceTemplateId'>;

export interface ProjectSummary {
  id: string;
  name: string;
  mode: Mode;
  createdAt: string;
  updatedAt: string;
  duration: number;
  ready: boolean;
  poster: string | null;
  cues: number;
  takes: number;
  template: boolean;
  sourceTemplateId: string | null;
  /** character names (identified voices) */
  characters: string[];
}

export function newId(prefix = 'x'): string {
  const r = (globalThis.crypto?.randomUUID?.() || Math.random().toString(16).slice(2) + Date.now().toString(16)).replace(/-/g, '');
  return prefix + r.slice(0, 8);
}

export function defaultProject({ id, name = 'Untitled', mode = 'pro' }: { id: string; name?: string; mode?: Mode }): Project {
  return {
    version: PROJECT_VERSION,
    id,
    name,
    mode,
    party: { sub: null },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    media: null,
    stems: { status: 'none', method: null },
    cues: [],
    lipFlaps: [],
    original: { volume: 1, mute: false, solo: false, source: 'full', ghost: { enabled: false, level: 0.25, pan: -1 } },
    ducking: { enabled: true, db: -12, attack: 0.04, release: 0.35, threshold: 0.02 },
    latencyMs: 0,
    tracks: [newTrack({ name: 'Voice 1' })],
    loop: null,
    settings: { preRoll: 3, preRollBeep: true, monitor: false, muteOriginalWhileRecording: false, output: 'headphones' },
    speakers: { list: [], segments: [] },
    markers: [],
    podcast: { trim: null, chapters: [], clean: { rumble: true, denoise: false, compress: true }, loudnorm: true, format: 'mp3' },
    template: false,
    sourceTemplateId: null,
  };
}

export function newTrack(o: Partial<Track> = {}): Track {
  return {
    id: newId('t'),
    name: 'Voice',
    kind: 'voice',
    color: pickColor(o.index || 0),
    volume: 1,
    pan: 0,
    mute: false,
    solo: false,
    fx: 'none',
    fxAmount: 1,
    micFix: true,
    nudgeMs: 0,
    clips: [],
    takes: [],
    ...o,
  };
}
export function newCue(o: Partial<Cue> = {}): Cue {
  return { id: newId('c'), start: 0, end: 1, text: '', character: '', note: '', ...o };
}

const COLORS = ['#d97b66', '#6fb3a6', '#7a9cc9', '#a98bc4', '#c9946a', '#9bb86f', '#c78fa5', '#8aa0a8'];
export function pickColor(i: number): string {
  return COLORS[i % COLORS.length];
}

/**
 * Overwrite a time range on a track: existing clips are trimmed/split around [start,end].
 * Nothing is deleted from disk; takes remain available.
 */
export function carveClips(clips: Clip[], start: number, end: number): Clip[] {
  const out: Clip[] = [];
  for (const c of clips) {
    const cs = c.start;
    const ce = c.start + c.duration;
    if (ce <= start || cs >= end) {
      out.push(c);
      continue;
    }
    if (cs < start) out.push({ ...c, id: newId('k'), duration: start - cs });
    if (ce > end) out.push({ ...c, id: newId('k'), start: end, offset: c.offset + (end - cs), duration: ce - end });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function projectDuration(p: { media?: { duration: number } | null; tracks: { clips: { start: number; duration: number }[] }[] }): number {
  let d = p.media?.duration || 0;
  for (const t of p.tracks) for (const c of t.clips) d = Math.max(d, c.start + c.duration);
  return d;
}

export type DeepPartial<T> = T extends (infer U)[] ? DeepPartial<U>[] : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
/** A project document as found on disk or sent by an older client. */
export type ProjectInput = DeepPartial<Project> & { id: string };

/** Fill defaults for older/partial project documents. */
export function migrate(input: ProjectInput): Project {
  const p = input as Partial<Project> & { id: string };
  const d = defaultProject({ id: p.id, name: p.name, mode: isMode(p.mode) ? p.mode : 'pro' });
  const out: Project = { ...d, ...p } as Project;
  out.original = { ...d.original, ...p.original, ghost: { ...d.original.ghost, ...p.original?.ghost } };
  out.ducking = { ...d.ducking, ...p.ducking };
  out.settings = { ...d.settings, ...p.settings };
  out.party = { ...d.party, ...p.party };
  out.speakers = { list: p.speakers?.list || [], segments: p.speakers?.segments || [] };
  out.podcast = { ...d.podcast, ...p.podcast, clean: { ...d.podcast.clean, ...p.podcast?.clean } };
  out.tracks = (p.tracks?.length ? p.tracks : d.tracks).map((t, i) => ({ ...newTrack({ index: i }), ...t, clips: t.clips || [], takes: t.takes || [] }));
  out.stems = p.stems || d.stems;
  out.template = !!p.template;
  out.sourceTemplateId = p.sourceTemplateId ?? null;
  out.version = PROJECT_VERSION;
  return out;
}

export function summarize(p: Project): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    mode: p.mode,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
    duration: p.media?.duration || 0,
    ready: !!p.media?.ready,
    poster: p.media?.ready ? `/media/${p.id}/poster.jpg` : null,
    cues: p.cues?.length || 0,
    takes: (p.tracks || []).reduce((n, t) => n + (t.clips?.length || 0), 0),
    template: !!p.template,
    sourceTemplateId: p.sourceTemplateId ?? null,
    characters: (p.speakers?.list || []).map((s) => s.name),
  };
}

/**
 * The prepared work a new project inherits from a library clip: subtitles, characters (voices back on), lip flaps,
 * marks, how the original plays. Recordings never come along; a derived project starts with one empty voice track.
 */
export function deriveDocument(clip: Project, p: Project): Project {
  return {
    ...p,
    media: clip.media,
    stems: clip.stems,
    cues: structuredClone(clip.cues),
    lipFlaps: structuredClone(clip.lipFlaps),
    markers: structuredClone(clip.markers),
    speakers: { list: clip.speakers.list.map((s) => ({ ...s, muted: false, solo: false })), segments: structuredClone(clip.speakers.segments) },
    original: { ...structuredClone(clip.original), mute: false, solo: false },
    sourceTemplateId: clip.id,
  };
}
