import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  apiBaseUrl: process.env.ELECTRON_API_URL || undefined,
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizedChange: (cb: (maximized: boolean) => void) => {
    ipcRenderer.on('window:maximized-change', (_e, val: boolean) => cb(val));
  },
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config: { deepgramApiKey?: string; groqApiKey?: string }) =>
    ipcRenderer.invoke('config:set', config),
});
