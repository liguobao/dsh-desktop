const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshPluginManager', Object.freeze({
  list: () => ipcRenderer.invoke('dsh-desktop:plugins-list'),
  install: (spec, allowBuildScripts = false) => ipcRenderer.invoke('dsh-desktop:plugins-install', spec, allowBuildScripts),
  setEnabled: (name, enabled) => ipcRenderer.invoke('dsh-desktop:plugins-enabled', name, enabled),
  remove: name => ipcRenderer.invoke('dsh-desktop:plugins-remove', name),
  restart: () => ipcRenderer.invoke('dsh-desktop:plugins-restart'),
  openDocs: () => ipcRenderer.invoke('dsh-desktop:plugins-docs'),
}))
