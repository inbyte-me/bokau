/// <reference lib="dom" />
// Script of key.html (bundled to key.js). Talks only to the preload-key bridge.
interface KeyBridge {
  status(): Promise<{ source: 'env' | 'saved' | 'none'; hint: string; canSave: boolean }>;
  save(key: string): Promise<{ ok: boolean; error?: string }>;
  clear(): Promise<{ ok: boolean }>;
  close(): void;
}
const bridge = (window as unknown as { keyWindow: KeyBridge }).keyWindow;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const state = $('state');
const input = $<HTMLInputElement>('key');
const msg = $('msg');

async function refresh() {
  const s = await bridge.status();
  state.textContent =
    s.source === 'env'
      ? `Using the key from the OPENROUTER_API_KEY environment variable (${s.hint}). It wins over a saved key.`
      : s.source === 'saved'
        ? `A key is saved (${s.hint}), encrypted with this computer's keychain. Paste a new one to replace it.`
        : 'No key yet. AI features (rewrites, translations) stay offline until you add one. The key stays on this computer.';
  $<HTMLButtonElement>('clear').disabled = s.source !== 'saved';
  $<HTMLButtonElement>('save').disabled = !s.canSave;
  if (!s.canSave) msg.textContent = 'This system cannot encrypt secrets; set OPENROUTER_API_KEY instead.';
}
$('save').addEventListener('click', async () => {
  const r = await bridge.save(input.value);
  msg.className = r.ok ? '' : 'error';
  msg.textContent = r.ok ? 'Saved.' : (r.error ?? 'Could not save.');
  if (r.ok) input.value = '';
  await refresh();
});
$('clear').addEventListener('click', async () => {
  await bridge.clear();
  msg.className = '';
  msg.textContent = 'Removed.';
  await refresh();
});
$('cancel').addEventListener('click', () => bridge.close());
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('save').click();
  if (e.key === 'Escape') bridge.close();
});
void refresh();
input.focus();
