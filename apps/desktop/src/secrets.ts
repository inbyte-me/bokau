import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';

/**
 * The OpenRouter key the user typed in the desktop app (File → OpenRouter Key…). Encrypted with the OS keychain
 * (Electron safeStorage) in the user-data folder, read only by the main process; the page never sees it.
 * An OPENROUTER_API_KEY environment variable still wins over it.
 */
export class KeyStore {
  readonly file: string;
  #cache: string | null = null;
  constructor(dir: string) {
    this.file = path.join(dir, 'openrouter.key');
  }
  get available(): boolean {
    return safeStorage.isEncryptionAvailable();
  }
  get(): string {
    if (this.#cache !== null) return this.#cache;
    try {
      this.#cache = safeStorage.decryptString(fs.readFileSync(this.file));
    } catch {
      this.#cache = '';
    }
    return this.#cache;
  }
  set(key: string): void {
    const k = key.trim();
    if (!/^sk-or-[\w-]{10,}$/.test(k)) throw new Error('That does not look like an OpenRouter key (it starts with sk-or-).');
    if (!this.available) throw new Error('This system cannot encrypt secrets (no keychain); set OPENROUTER_API_KEY instead.');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, safeStorage.encryptString(k), { mode: 0o600 });
    this.#cache = k;
  }
  clear(): void {
    fs.rmSync(this.file, { force: true });
    this.#cache = '';
  }
}

/** Last 4 characters only, for showing which key is stored. */
export const hint = (key: string): string => (key ? `…${key.slice(-4)}` : '');
