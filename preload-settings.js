const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: payload => ipcRenderer.invoke('settings:save', payload),
  test: (key, values) => ipcRenderer.invoke('settings:test', { key, values }),
  pickFile: (multi, extensions) => ipcRenderer.invoke('settings:pickFile', { multi, extensions }),
  pickDir: () => ipcRenderer.invoke('settings:pickDir'),
});
