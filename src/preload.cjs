const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshDesktop', Object.freeze({
  openPath: (path, intent = 'auto') => ipcRenderer.invoke('dsh-desktop:open-path', path, intent),
  publishWorkspaceContext: context => ipcRenderer.send('dsh-desktop:workspace-context', context),
  getUpdateState: () => ipcRenderer.invoke('dsh-desktop:update-state'),
  activateUpdate: () => ipcRenderer.invoke('dsh-desktop:update-activate'),
  onUpdateState: callback => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('dsh-desktop:update-state', listener)
    return () => ipcRenderer.removeListener('dsh-desktop:update-state', listener)
  },
}))
