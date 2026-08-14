const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshExtensionManager', Object.freeze({
  list: () => ipcRenderer.invoke('dsh-desktop:skills-list'),
  create: (name, description) => ipcRenderer.invoke('dsh-desktop:skills-create', name, description),
  importFolder: () => ipcRenderer.invoke('dsh-desktop:skills-import'),
  setEnabled: (entry, enabled) => ipcRenderer.invoke('dsh-desktop:skills-enabled', entry, enabled),
  reveal: (entry, enabled) => ipcRenderer.invoke('dsh-desktop:skills-reveal', entry, enabled),
  remove: (entry, enabled) => ipcRenderer.invoke('dsh-desktop:skills-remove', entry, enabled),
  openRoot: () => ipcRenderer.invoke('dsh-desktop:skills-open-root'),
  openDocs: () => ipcRenderer.invoke('dsh-desktop:skills-docs'),
}))
