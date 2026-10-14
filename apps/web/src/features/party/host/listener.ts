// The TV listens to each submitted take (Whisper in the browser, the same model as subtitles, told the language the
// players speak) and tells the room what the player actually said: the next player and the next suggestion use it. One take at a time; failures are skipped:
// a suggestion without the real text is still a suggestion.
import type { HostCommand, PartyLanguage, Room } from '@doblaje/party';

/** Whisper names languages in full (as the Script panel does). */
const WHISPER_LANGUAGE: Record<PartyLanguage, string> = { en: 'english', es: 'spanish', fr: 'french', pt: 'portuguese', de: 'german', it: 'italian' };

export class TakeListener {
  #done = new Set<string>();
  #queue: { projectId: string; cueId: string; file: string; key: string; language: string }[] = [];
  #busy = false;
  #client: { host(command: HostCommand): boolean };

  constructor(client: { host(command: HostCommand): boolean }) {
    this.#client = client;
  }

  /** Queue the takes of this room that have not been heard yet. */
  update(room: Room): void {
    if (!room.projectId) return;
    for (const r of room.results) {
      const key = `${room.round}|${r.cueId}|${r.file}`;
      if (!r.file || room.heard[r.cueId] || this.#done.has(key)) continue;
      this.#done.add(key);
      this.#queue.push({ projectId: room.projectId, cueId: r.cueId, file: r.file, key, language: WHISPER_LANGUAGE[room.settings.language] });
    }
    void this.#next();
  }

  async #next(): Promise<void> {
    if (this.#busy) return;
    const job = this.#queue.shift();
    if (!job) return;
    this.#busy = true;
    try {
      const { load16k, transcribe } = await import('@doblaje/speech');
      const audio = await load16k(`/media/${job.projectId}/takes/${job.file}`);
      const { text } = await transcribe(audio, { model: 'Xenova/whisper-base', language: job.language });
      const said = text.trim();
      if (said) this.#client.host({ type: 'heard', cueId: job.cueId, text: said });
    } catch (e) {
      console.warn('[party] could not transcribe a take', e);
    } finally {
      this.#busy = false;
      void this.#next();
    }
  }
}
