const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stickies', {
  ready: () => ipcRenderer.send('note:ready'),
  onData: cb => ipcRenderer.on('note:data', (e, note) => cb(note)),
  reportHeight: h => ipcRenderer.send('note:height', h),
  edit: (id, text) => ipcRenderer.send('note:edit', { id, text }),
  setDeadline: (id, deadline) => ipcRenderer.send('note:deadline', { id, deadline }),
  close: id => ipcRenderer.send('note:close', id),
  done: id => ipcRenderer.send('note:done', id),
  pin: (id, pinned) => ipcRenderer.send('note:pin', { id, pinned }),
  openSource: id => ipcRenderer.send('note:openSource', id),
  scroll: dy => ipcRenderer.send('column:scroll', dy),
  step: dir => ipcRenderer.send('column:step', dir),
});
