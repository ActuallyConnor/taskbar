const { contextBridge, ipcRenderer } = require('electron')

const mrId = ({ projectId, iid }) => ({ projectId, iid })

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: config => ipcRenderer.invoke('config:save', config),
  refresh: () => ipcRenderer.invoke('refresh'),
  details: mr => ipcRenderer.invoke('mr:details', mrId(mr)),
  changes: mr => ipcRenderer.invoke('mr:changes', mrId(mr)),
  comment: (mr, c) => ipcRenderer.invoke('mr:comment', mrId(mr), c),
  note: (mr, body) => ipcRenderer.invoke('mr:note', mrId(mr), body),
  reply: (mr, id, body) => ipcRenderer.invoke('mr:reply', mrId(mr), id, body),
  resolve: (mr, id, resolved) => ipcRenderer.invoke('mr:resolve', mrId(mr), id, resolved),
  move: (id, status) => ipcRenderer.invoke('mr:move', id, status),
  approveMr: mr => ipcRenderer.invoke('mr:approve', mrId(mr)),
  getReviews: () => ipcRenderer.invoke('review:get'),
  startReview: (mr, provider) => ipcRenderer.invoke('review:start', mrId(mr), provider),
  cancelReview: mr => ipcRenderer.invoke('review:cancel', mrId(mr)),
  askReview: (mr, question) => ipcRenderer.invoke('review:ask', mrId(mr), question),
  onReviews: fn => ipcRenderer.on('reviews', (_e, r) => fn(r)),
  onState: fn => ipcRenderer.on('state', (_e, s) => fn(s)),
  getNotifications: () => ipcRenderer.invoke('notifications:get'),
  clearNotifications: id => ipcRenderer.invoke('notifications:clear', id),
  onNotifications: fn => ipcRenderer.on('notifications', (_e, n) => fn(n)),
  onSelect: fn => ipcRenderer.on('select', (_e, id) => fn(id)),
})
