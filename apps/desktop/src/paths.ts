import path from 'node:path';
import type { App } from 'electron';

export interface DesktopPaths {
  dataDir: string;
  modelsDir: string;
  webDir: string;
  playDir: string;
  migrationsDir: string;
  vendorDirs: { transformers: string; ort: string };
  toolsDir: string;
  envFile: string | null;
}

/**
 * Where everything lives. Packaged: read-only assets in the app's resources, user data in the OS
 * user-data folder (~/Library/Application Support/Doblaje Studio on macOS). Unpackaged (`pnpm desktop`):
 * assets come from the repository build, data still goes to the user-data folder unless DOBLAJE_DATA is set.
 */
export function resolvePaths(app: App): DesktopPaths {
  const user = app.getPath('userData');
  const bundle = import.meta.dirname; // apps/desktop/dist, or <resources>/app.asar/dist when packaged
  const res = app.isPackaged ? process.resourcesPath : path.resolve(bundle, '..');
  // Running from the repository (`pnpm desktop`): share the repo's installed tools (Demucs via `pnpm setup:separation`)
  // and downloaded speech models with the server. Packaged: everything under the user-data folder.
  const repo = path.resolve(bundle, '..', '..', '..');
  return {
    dataDir: process.env.DOBLAJE_DATA || path.join(user, 'data'),
    modelsDir: process.env.DOBLAJE_MODELS || (app.isPackaged ? path.join(user, 'models') : path.join(repo, 'models')),
    webDir: app.isPackaged ? path.join(res, 'web') : path.resolve(bundle, '..', '..', 'web', 'dist'),
    playDir: app.isPackaged ? path.join(res, 'play') : path.resolve(bundle, '..', '..', 'play', 'dist'),
    migrationsDir: path.join(app.isPackaged ? res : path.join(res, 'dist'), 'drizzle'),
    vendorDirs: { transformers: path.join(bundle, 'vendor', 'transformers'), ort: path.join(bundle, 'vendor', 'ort') },
    toolsDir: process.env.DOBLAJE_TOOLS || (app.isPackaged ? path.join(user, 'tools') : path.join(repo, 'tools')),
    envFile: path.join(user, '.env'),
  };
}
