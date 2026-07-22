const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('widget', Object.freeze({
  dragStart: (offX, offY) => ipcRenderer.send('drag-start', offX, offY),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  wheel: (dy) => ipcRenderer.send('wheel', dy),
  contextMenu: () => ipcRenderer.send('context-menu'),
}))
