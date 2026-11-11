const { contextBridge, ipcRenderer } = require('electron')

const mrId = ({ projectId, iid }) => ({ projectId, iid })

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: config => ipcRenderer.invoke('config:save', config),
  refresh: () => ipcRenderer.invoke('refresh'),
  details: mr => ipcRenderer.invoke('mr:details', mrId(mr)),
  approveMr: mr => ipcRenderer.invoke('mr:approve', mrId(mr)),
  getReviews: () => ipcRenderer.invoke('review:get'),
  startReview: (mr, provider) => ipcRenderer.invoke('review:start', mrId(mr), provider),
  askReview: (mr, question) => ipcRenderer.invoke('review:ask', mrId(mr), question),
  onReviews: fn => ipcRenderer.on('reviews', (_e, r) => fn(r)),
  onState: fn => ipcRenderer.on('state', (_e, s) => fn(s)),
  getNotifications: () => ipcRenderer.invoke('notifications:get'),
  clearNotifications: id => ipcRenderer.invoke('notifications:clear', id),
  onNotifications: fn => ipcRenderer.on('notifications', (_e, n) => fn(n)),
  onSelect: fn => ipcRenderer.on('select', (_e, id) => fn(id)),
})
