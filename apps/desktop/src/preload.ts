// Sandboxed preload: the page gets a tiny, read-only description of the shell and one channel for native menu
// commands (File → Save…). Nothing else of Electron or Node is exposed.
import { contextBridge, ipcRenderer } from 'electron';

const COMMANDS = new Set(['save', 'export', 'new', 'open', 'close', 'ai-changed']);

contextBridge.exposeInMainWorld('doblajeDesktop', {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  onMenuCommand(cb: (cmd: string) => void) {
    ipcRenderer.on('menu-command', (_e, cmd: unknown) => {
      if (typeof cmd === 'string' && COMMANDS.has(cmd)) cb(cmd);
    });
  },
});
