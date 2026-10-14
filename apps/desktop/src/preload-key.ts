// Preload of the small "OpenRouter key" window only: save, clear, status. The main app window never gets these.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('keyWindow', {
  status: (): Promise<{ source: 'env' | 'saved' | 'none'; hint: string; canSave: boolean }> => ipcRenderer.invoke('key:status'),
  save: (key: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('key:save', String(key)),
  clear: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('key:clear'),
  close: (): void => ipcRenderer.send('key:close'),
});
