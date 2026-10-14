// Desktop shell: runs the same backend (@doblaje/api) inside Electron's main process on a random
// loopback port and shows the built web app in a locked-down window. Data lives in the OS user-data folder.
import fs from 'node:fs';
import path from 'node:path';
import { type App, createApp } from '@doblaje/api';
import { app, BrowserWindow, dialog, ipcMain, session, shell, systemPreferences } from 'electron';
import { installMenu } from './menu.ts';
import { resolvePaths } from './paths.ts';
import { hint, KeyStore } from './secrets.ts';

const SMOKE = process.env.DOBLAJE_SMOKE === '1'; // used by the e2e smoke test: start, load, report, quit

let backend: App | null = null;
let win: BrowserWindow | null = null;
let keyWin: BrowserWindow | null = null;

if (SMOKE) {
  // isolated profile: a smoke run must not collide with (or be blocked by) a running copy of the app
  app.setPath('userData', fs.mkdtempSync(path.join(app.getPath('temp'), 'doblaje-smoke-')));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (win?.isMinimized()) win.restore();
  win?.focus();
});

async function start(): Promise<void> {
  const paths = resolvePaths(app);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  const keys = new KeyStore(app.getPath('userData'));
  backend = await createApp({
    host: '127.0.0.1',
    port: 0,
    dataDir: paths.dataDir,
    modelsDir: paths.modelsDir,
    webDir: paths.webDir,
    playDir: fs.existsSync(paths.playDir) ? paths.playDir : null,
    // the environment wins; otherwise the key saved from File → OpenRouter Key…
    ai: { apiKey: () => process.env.OPENROUTER_API_KEY || keys.get() },
    migrationsDir: paths.migrationsDir,
    vendorDirs: paths.vendorDirs,
    toolsDir: paths.toolsDir,
    envFile: paths.envFile,
  });
  const port = await backend.listen();
  const origin = `http://127.0.0.1:${port}`;
  const startUrl = process.env.DOBLAJE_WEB_URL || `${origin}/`;
  const allowed = new Set([new URL(startUrl).origin, origin]);

  // Camera and microphone only for our own pages; everything else is denied.
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    const ok = allowed.has(new URL(wc.getURL()).origin) && ['media', 'fullscreen', 'speaker-selection'].includes(permission);
    cb(ok);
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => allowed.has(requestingOrigin) && ['media', 'speaker-selection'].includes(permission));
  if (process.platform === 'darwin' && !SMOKE) {
    await systemPreferences.askForMediaAccess('microphone').catch(() => false);
  }

  installKeyWindow(keys);
  installMenu(() => win, { openKeyWindow });
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#121211',
    title: 'Doblaje Studio',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  // Links to other sites open in the system browser; the window never navigates away from the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !allowed.has(new URL(url).origin)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!allowed.has(new URL(url).origin)) e.preventDefault();
  });
  win.once('ready-to-show', () => {
    if (!SMOKE) win?.show();
  });
  await win.loadURL(startUrl);

  if (SMOKE) {
    const title = await win.webContents.executeJavaScript(
      'new Promise((r) => { const f = () => document.querySelector("#new-project") ? r(document.title) : setTimeout(f, 50); f(); })',
    );
    const health = await (await fetch(`${origin}/api/health`)).json();
    const system = (await (await fetch(`${origin}/api/system`)).json()) as { neuralSeparation: boolean };
    console.log(
      `SMOKE ${JSON.stringify({ title, port, health, neuralSeparation: system.neuralSeparation, toolsDir: paths.toolsDir, dataDir: paths.dataDir, electron: process.versions.electron, node: process.versions.node })}`,
    );
    app.quit();
  }
}

/** File → OpenRouter Key…: a small separate window with its own preload, so the key never passes through the app page. */
function openKeyWindow(): void {
  if (keyWin) {
    keyWin.focus();
    return;
  }
  keyWin = new BrowserWindow({
    width: 480,
    height: 250,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: win ?? undefined,
    modal: process.platform !== 'darwin' && !!win,
    title: 'OpenRouter Key',
    backgroundColor: '#121211',
    webPreferences: { preload: path.join(import.meta.dirname, 'preload-key.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  keyWin.removeMenu();
  keyWin.webContents.on('will-navigate', (e) => e.preventDefault());
  keyWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  keyWin.on('closed', () => {
    keyWin = null;
  });
  void keyWin.loadFile(path.join(import.meta.dirname, 'key.html'));
}

function installKeyWindow(keys: KeyStore): void {
  const fromKeyWindow = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => !!keyWin && e.sender === keyWin.webContents;
  const changed = () => win?.webContents.send('menu-command', 'ai-changed');
  ipcMain.handle('key:status', (e) => {
    if (!fromKeyWindow(e)) throw new Error('forbidden');
    const env = process.env.OPENROUTER_API_KEY || '';
    const saved = keys.get();
    return { source: env ? 'env' : saved ? 'saved' : 'none', hint: hint(env || saved), canSave: keys.available };
  });
  ipcMain.handle('key:save', (e, key: unknown) => {
    if (!fromKeyWindow(e)) throw new Error('forbidden');
    try {
      keys.set(String(key));
      changed();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('key:clear', (e) => {
    if (!fromKeyWindow(e)) throw new Error('forbidden');
    keys.clear();
    changed();
    return { ok: true };
  });
  ipcMain.on('key:close', (e) => {
    if (fromKeyWindow(e)) keyWin?.close();
  });
}

app
  .whenReady()
  .then(start)
  .catch((e: unknown) => {
    console.error(e);
    if (!SMOKE) dialog.showErrorBox('Doblaje Studio could not start', e instanceof Error ? e.message : String(e));
    app.exit(1);
  });

app.on('window-all-closed', () => app.quit());
// Close the HTTP server and the database before the process ends; then exit for real.
app.on('will-quit', (e) => {
  if (!backend) return;
  e.preventDefault();
  const b = backend;
  backend = null;
  void b.close().finally(() => app.exit(0));
});
