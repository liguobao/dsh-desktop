const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshDesktop', Object.freeze({
  openPath: path => ipcRenderer.invoke('dsh-desktop:open-path', path),
  publishWorkspaceContext: context => ipcRenderer.send('dsh-desktop:workspace-context', context),
}))
