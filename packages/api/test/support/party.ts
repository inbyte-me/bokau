// Test doubles for party rooms: a WebSocket client (the TV or a phone) and a tiny WAV maker.
import type { ServerMessage, View } from '@doblaje/party';

/** A WebSocket client that keeps every message and can wait for one. */
export class Client {
  readonly ws: WebSocket;
  readonly inbox: ServerMessage[] = [];
  #waiters: (() => void)[] = [];
  constructor(base: string) {
    this.ws = new WebSocket(`${base.replace(/^http/, 'ws')}/party/ws`);
    this.ws.addEventListener('message', (e) => {
      this.inbox.push(JSON.parse(String(e.data)) as ServerMessage);
      for (const w of this.#waiters.splice(0)) w();
    });
  }
  open() {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', () => reject(new Error('socket error')));
    });
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  /** the first queued or future message that matches (earlier ones are dropped) */
  async next<T extends ServerMessage>(pred: (m: ServerMessage) => m is T, timeoutMs = 10_000): Promise<T> {
    const t0 = Date.now();
    let seen = 0;
    for (;;) {
      for (; seen < this.inbox.length; seen++) {
        const m = this.inbox[seen];
        if (pred(m)) {
          this.inbox.splice(0, seen + 1);
          return m;
        }
      }
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout; last: ${JSON.stringify(this.inbox.at(-1))?.slice(0, 300)}`);
      await new Promise<void>((r) => {
        this.#waiters.push(r);
        setTimeout(r, 200);
      });
    }
  }
  view<V extends View>(check: (v: V) => boolean = () => true) {
    return this.next((m): m is Extract<ServerMessage, { type: 'view' }> => m.type === 'view' && check(m.view as V)).then((m) => m.view as V);
  }
  close() {
    this.ws.close();
  }
}

/** one second of a quiet tone as a 16-bit mono WAV */
export function wav(seconds = 1, sr = 48000): Buffer {
  const n = Math.round(seconds * sr);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / sr) * 2 * Math.PI * 220) * 3000), 44 + i * 2);
  return b;
}
