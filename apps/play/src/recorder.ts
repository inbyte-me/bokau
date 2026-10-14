// The phone's recording kit: the studio's own engine, mic and recording session (same mix graph, same
// latency-compensated capture), pointed at the room's media and holding the take until the player submits it.
import { Engine, encodeWav, Mic, type ProjectStore, type RecordedTake, RecordSession } from '@doblaje/audio';
import { clamp, type Project } from '@doblaje/core';
import type { LineView } from '@doblaje/party';
import { partyMedia, partyVideo } from './media.ts';

/** Seconds of scene before and after a line: enough to catch the moment, short enough to keep it frantic. */
export const LEAD = 2;
export const TAIL = 0.8;
/** Kept around the line in the submitted take (the lead-in is for the player's ears, not the recording). */
const KEEP_BEFORE = 0.25;
const KEEP_AFTER = 0.6;

/** The project, held in memory: commits apply directly (nothing is saved from a phone except the take). */
class LocalStore implements ProjectStore {
  project: Project | null = null;
  commit(_label: string, fn: (p: Project) => void): void {
    if (this.project) fn(this.project);
  }
}

export interface Take {
  take: RecordedTake;
  /** timeline start of the trimmed take */
  start: number;
  wav: Blob;
  seconds: number;
}

export class PhoneRecorder {
  readonly engine = new Engine();
  readonly mic = new Mic(this.engine);
  readonly store = new LocalStore();
  readonly session: RecordSession;
  #code: string;
  #token: string;
  #trackId = '';
  /** the picture to show (a local copy once downloaded) */
  #videoSrc: string | null = null;
  /** the line being recorded (a subtitle cue, or a blind-dubbing segment that is not one) */
  #line: { start: number; end: number } | null = null;
  take: Take | null = null;

  constructor(code: string, token: string) {
    this.#code = code;
    this.#token = token;
    this.engine.mediaUrl = (_id, file) => this.mediaUrl(file);
    // takes stay on the phone until "Send": the session's upload step just remembers the last one
    this.session = new RecordSession({ engine: this.engine, mic: this.mic, store: this.store, upload: async (_p, take) => this.#keep(take) });
  }

  mediaUrl(file: string): string {
    return partyMedia(this.#code, this.#token, file);
  }

  /** Load the round's project (from the room): the audio is decoded once for the whole round. */
  async load(): Promise<void> {
    const r = await fetch(`/api/party/rooms/${this.#code}/project`, { headers: { 'x-party-token': this.#token } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({ error: `HTTP ${r.status}` }))).error);
    const p = (await r.json()) as Project;
    // one private track for this phone; the studio's settings tuned for a quick take in headphones
    p.tracks = [{ ...p.tracks[0], id: 'phone', name: 'Me', clips: [], takes: [], micFix: true, fx: 'none' }];
    p.settings = { ...p.settings, preRoll: 2, preRollBeep: true, monitor: false, muteOriginalWhileRecording: false, output: 'headphones' };
    p.dubbed = [];
    this.#trackId = 'phone';
    this.store.project = p;
    // the picture is downloaded once, with the audio (see partyVideo)
    const [src] = await Promise.all([partyVideo(this.#code, this.#token, p.id), this.engine.load(p, null)]);
    this.#videoSrc = src;
  }

  /** Show the scene in this element (each turn screen has its own; the browser caches the file). */
  attachVideo(video: HTMLVideoElement): void {
    video.muted = true;
    video.playsInline = true;
    video.src = this.#videoSrc ?? this.mediaUrl('proxy.mp4');
    this.engine.video = video;
  }

  /** Show the first frame of a moment (before playing it; never moves a running take). */
  cue(t: number): void {
    if (!this.engine.playing) this.engine.seek(Math.max(0, t));
  }

  detachVideo(): void {
    this.engine.pause();
    this.engine.video = null;
  }

  get loaded(): boolean {
    return !!this.store.project && !!this.engine.assets;
  }

  /** Ask for the microphone (needs a tap first on phones). Raw input: echo cancellation would eat the voice. */
  async openMic(): Promise<void> {
    await this.engine.init();
    await this.engine.resume();
    if (!this.mic.isOpen) await this.mic.open({ aec: false, monitor: false, channel: 'auto' });
    const p = this.store.project;
    if (p) p.latencyMs = this.#estimateLatency();
  }

  /**
   * Round-trip estimate without a calibration chirp (that would need speakers): what the browser reports for its
   * output path plus the input track's latency. Phones are good to ~20 ms here; this is a party game.
   */
  #estimateLatency(): number {
    const track = this.mic.stream?.getAudioTracks()[0];
    const input = (track?.getSettings() as MediaTrackSettings & { latency?: number })?.latency ?? 0.01;
    return Math.round(clamp((this.engine.outputLatency + input) * 1000, 0, 400));
  }

  /** Blind dubbing: the scene stays silent (music and voices), the player improvises over the picture. */
  silent = false;

  /** The scene around the line (original voices on, or silent for blind dubbing). */
  async watch(line: LineView): Promise<void> {
    const p = this.store.project;
    if (!p) return;
    p.dubbed = [];
    await this.engine.resume();
    this.engine.muteOriginal = this.silent;
    await this.engine.playRange(Math.max(0, line.start - LEAD), line.end + TAIL, { include: { original: true, voices: false, ghost: false } });
  }

  /** Blind dubbing: the last second of the previous player's take (all this player gets to hear of it). */
  async playPrevious(take: string): Promise<void> {
    await this.engine.resume();
    const r = await fetch(this.mediaUrl(`takes/${take}`));
    if (!r.ok) return;
    const buf = await this.engine.ctx.decodeAudioData(await r.arrayBuffer());
    const ctx = this.engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const from = Math.max(0, buf.duration - 1);
    await new Promise<void>((done) => {
      src.onended = () => done();
      src.start(ctx.currentTime + 0.05, from);
    });
  }

  /** Countdown, then record over the scene with this character's line silenced. */
  async record(line: LineView): Promise<void> {
    const p = this.store.project;
    if (!p) return;
    await this.openMic();
    this.take = null;
    this.#line = { start: line.start, end: line.end };
    p.dubbed = [{ start: line.start, end: line.end }];
    const t = p.tracks[0];
    t.clips = [];
    t.takes = [];
    this.engine.muteOriginal = this.silent;
    p.settings.muteOriginalWhileRecording = this.silent; // the session restores the engine's own setting afterwards
    await this.session.start({ trackId: this.#trackId, start: Math.max(0, line.start - LEAD), end: line.end + TAIL, cueId: line.cueId });
  }

  stop(): void {
    if (this.session.state !== 'idle') this.session.stop();
    else this.engine.pause();
  }

  /** Hear the take in the scene. */
  async listen(line: LineView): Promise<void> {
    const p = this.store.project;
    if (!p || !this.take) return;
    p.dubbed = [{ start: line.start, end: line.end }];
    await this.engine.resume();
    this.engine.muteOriginal = this.silent;
    await this.engine.playRange(Math.max(0, line.start - LEAD), line.end + TAIL);
  }

  /** Keep the part of the capture around the line, as a 16-bit WAV. */
  #keep(take: RecordedTake): void {
    const buf = this.engine.assets?.takes.get(take.file);
    const line = this.#line;
    if (!buf || !line) return;
    const sr = buf.sampleRate;
    const from = Math.max(take.start, line.start - KEEP_BEFORE);
    const to = Math.min(take.start + take.duration, line.end + KEEP_AFTER);
    const a = Math.max(0, Math.round((from - take.start) * sr));
    const b = Math.max(a, Math.round((to - take.start) * sr));
    const data = buf.getChannelData(0).slice(a, b);
    this.take = { take, start: from, wav: encodeWav([data], sr, 16), seconds: data.length / sr };
  }

  /** Send the take for this turn. */
  async submit(turn: number): Promise<void> {
    const k = this.take;
    if (!k) throw new Error('nothing recorded');
    const r = await fetch(`/api/party/rooms/${this.#code}/takes?turn=${turn}&start=${k.start.toFixed(3)}`, {
      method: 'POST',
      headers: { 'x-party-token': this.#token, 'content-type': 'audio/wav' },
      body: k.wav,
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({ error: `HTTP ${r.status}` }))).error);
    this.take = null;
  }

  dispose(): void {
    this.stop();
    this.mic.close();
    if (this.engine.initialised) void this.engine.ctx.close().catch(() => {});
  }
}
