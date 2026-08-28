const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshDesktop', Object.freeze({
  openPath: (path, intent = 'auto') => ipcRenderer.invoke('dsh-desktop:open-path', path, intent),
  publishWorkspaceContext: context => ipcRenderer.send('dsh-desktop:workspace-context', context),
  repairEnvironment: () => ipcRenderer.invoke('dsh-desktop:repair-environment'),
}))
