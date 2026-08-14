const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshPluginManager', Object.freeze({
  list: () => ipcRenderer.invoke('dsh-desktop:plugins-list'),
  install: (spec, allowBuildScripts = false) => ipcRenderer.invoke('dsh-desktop:plugins-install', spec, allowBuildScripts),
  setEnabled: (name, enabled) => ipcRenderer.invoke('dsh-desktop:plugins-enabled', name, enabled),
  remove: name => ipcRenderer.invoke('dsh-desktop:plugins-remove', name),
  restart: () => ipcRenderer.invoke('dsh-desktop:plugins-restart'),
  openDocs: () => ipcRenderer.invoke('dsh-desktop:plugins-docs'),
  skills: Object.freeze({
    list: () => ipcRenderer.invoke('dsh-desktop:skills-list'),
    create: (name, description) => ipcRenderer.invoke('dsh-desktop:skills-create', name, description),
    importFolder: () => ipcRenderer.invoke('dsh-desktop:skills-import'),
    setEnabled: (entry, enabled) => ipcRenderer.invoke('dsh-desktop:skills-enabled', entry, enabled),
    reveal: (entry, enabled) => ipcRenderer.invoke('dsh-desktop:skills-reveal', entry, enabled),
    remove: (entry, enabled) => ipcRenderer.invoke('dsh-desktop:skills-remove', entry, enabled),
    openRoot: () => ipcRenderer.invoke('dsh-desktop:skills-open-root'),
    openDocs: () => ipcRenderer.invoke('dsh-desktop:skills-docs'),
  }),
}))
