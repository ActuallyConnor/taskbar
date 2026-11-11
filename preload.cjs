const { contextBridge, ipcRenderer } = require('electron')

const mrId = ({ projectId, iid }) => ({ projectId, iid })

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: config => ipcRenderer.invoke('config:save', config),
  refresh: () => ipcRenderer.invoke('refresh'),
  details: mr => ipcRenderer.invoke('mr:details', mrId(mr)),
  approveMr: mr => ipcRenderer.invoke('mr:approve', mrId(mr)),
  onState: fn => ipcRenderer.on('state', (_e, s) => fn(s)),
  onSelect: fn => ipcRenderer.on('select', (_e, id) => fn(id)),
})
