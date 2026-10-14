// Podcast recording: camera + microphone into a MediaRecorder; every second is streamed to the server as it is
// captured (a crash loses at most a second), chapters can be added while recording. Ends in an ingest job.
import { errorMessage } from '@doblaje/core';
import { t } from '@doblaje/ui';
import { api } from '../../api.ts';
import { app } from '../../app.svelte.ts';
import { openMic } from '../../shell/mic.svelte.ts';

const MIME_VIDEO = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const MIME_AUDIO = ['audio/webm;codecs=opus', 'audio/webm'];
const pickMime = (list: string[]) => list.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

export class PodcastRecorder {
  state = $state<'idle' | 'recording' | 'paused' | 'finishing'>('idle');
  useVideo = $state(read('podVideo') !== '0');
  cameras = $state.raw<MediaDeviceInfo[]>([]);
  cameraId = $state('');
  camera = $state.raw<MediaStream | null>(null);
  bytes = $state(0);
  /** seconds recorded (excluding pauses), updated a few times per second */
  elapsed = $state(0);
  status = $state(t('Choose your camera and microphone, check the level, then record.'));
  #rec: MediaRecorder | null = null;
  #startedAt = 0;
  #pausedAt = 0;
  #pausedTotal = 0;
  #queue: Promise<void> = Promise.resolve();
  #tick: ReturnType<typeof setInterval> | undefined;
  readonly projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  #now(): number {
    return (this.state === 'paused' ? this.#pausedAt : performance.now()) - this.#startedAt - this.#pausedTotal;
  }

  async openCamera(): Promise<void> {
    this.#stopCamera();
    if (!this.useVideo) {
      this.status = t('Audio only: no camera will be recorded.');
      return;
    }
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: this.cameraId ? { exact: this.cameraId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      this.camera = cam;
      this.cameraId = cam.getVideoTracks()[0].getSettings().deviceId || '';
      this.cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    } catch (e) {
      this.status = t('Camera unavailable: {m}. You can still record audio only.', { m: errorMessage(e) });
    }
  }
  setUseVideo(on: boolean): void {
    this.useVideo = on;
    try {
      localStorage.setItem('podVideo', on ? '1' : '0');
    } catch {}
    void this.openCamera();
  }
  #stopCamera() {
    for (const x of this.camera?.getTracks() ?? []) x.stop();
    this.camera = null;
  }

  async toggle(): Promise<void> {
    if (this.state === 'idle') await this.start();
    else if (this.state === 'recording' || this.state === 'paused') await this.stop();
  }

  async start(): Promise<void> {
    if (!app.mic.isOpen && !(await openMic())) return;
    if (this.useVideo && !this.camera) await this.openCamera();
    const cam = this.useVideo ? this.camera : null;
    const mimeType = pickMime(cam ? MIME_VIDEO : MIME_AUDIO);
    const tracks = [...(cam ? cam.getVideoTracks() : []), ...app.mic.recordStream.getAudioTracks()];
    const r = new MediaRecorder(new MediaStream(tracks), { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 3_000_000, audioBitsPerSecond: 192_000 });
    this.#rec = r;
    await api.post(`/api/projects/${this.projectId}/recording/start`, {});
    this.bytes = 0;
    this.#queue = Promise.resolve();
    app.store.commit(
      'Reset chapters',
      (p) => {
        p.podcast.chapters = [];
      },
      ['podcast'],
    );
    r.ondataavailable = (e) => {
      if (!e.data.size) return;
      this.bytes += e.data.size;
      const chunk = e.data;
      this.#queue = this.#queue
        .then(() =>
          fetch(`/api/projects/${this.projectId}/recording/append`, { method: 'POST', body: chunk }).then((res) => {
            if (!res.ok) throw new Error(`upload ${res.status}`);
          }),
        )
        .catch((err: unknown) => {
          this.status = t('Saving failed: {m}', { m: errorMessage(err) });
        });
    };
    r.start(1000);
    this.#startedAt = performance.now();
    this.#pausedTotal = 0;
    this.state = 'recording';
    this.status = t('Recording. Each second is saved to disk as it is captured.');
    this.#tick = setInterval(() => {
      this.elapsed = this.#now() / 1000;
    }, 200);
  }

  pauseResume(): void {
    const r = this.#rec;
    if (!r) return;
    if (this.state === 'recording') {
      r.pause();
      this.#pausedAt = performance.now();
      this.state = 'paused';
      this.status = t('Paused.');
    } else if (this.state === 'paused') {
      r.resume();
      this.#pausedTotal += performance.now() - this.#pausedAt;
      this.state = 'recording';
      this.status = t('Recording. Each second is saved to disk as it is captured.');
    }
  }

  addChapter(): void {
    if (this.state === 'idle' || this.state === 'finishing') return;
    const at = this.#now() / 1000;
    app.store.commit('Add chapter', (p) => void p.podcast.chapters.push({ t: at, title: `${t('Chapter')} ${p.podcast.chapters.length + 1}` }), ['podcast']);
  }

  /** Stop, wait for the last chunks, and turn the recording into the project's media (ingest). */
  async stop(): Promise<void> {
    clearInterval(this.#tick);
    const r = this.#rec;
    if (!r) return;
    await new Promise((res) => {
      r.onstop = res;
      r.stop();
    });
    this.state = 'finishing';
    this.status = t('Finishing the recording…');
    await this.#queue;
    try {
      const kind = this.useVideo && this.camera ? 'video' : 'audio';
      const { job } = await api.post<{ job: string }>(`/api/projects/${this.projectId}/recording/finish?kind=${kind}`, {});
      await api.waitJob(job, (j) => {
        this.status = `${t('Preparing')}: ${j.message || ''} ${Math.round(j.progress * 100)}%`;
      });
      this.#stopCamera();
      await app.store.flush();
      const fresh = await api.project(this.projectId);
      app.store.refreshServerParts(fresh); // the screen switches to review when media is ready
    } catch (e) {
      this.state = 'idle';
      this.status = errorMessage(e);
      throw e;
    }
  }

  dispose(): void {
    clearInterval(this.#tick);
    this.#stopCamera();
    if (this.state === 'recording' || this.state === 'paused') {
      try {
        this.#rec?.stop();
      } catch {}
    }
  }
}
