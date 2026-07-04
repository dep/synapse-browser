import { contextBridge, ipcRenderer } from 'electron'
import type { SynapseApi } from '../shared/ipc'

const api: SynapseApi = {
  tabs: {
    create: (url) => ipcRenderer.send('tabs:create', url),
    close: (id) => ipcRenderer.send('tabs:close', id),
    activate: (id) => ipcRenderer.send('tabs:activate', id),
    navigate: (id, input) => ipcRenderer.send('tabs:navigate', id, input),
    back: (id) => ipcRenderer.send('tabs:back', id),
    forward: (id) => ipcRenderer.send('tabs:forward', id),
    reload: (id) => ipcRenderer.send('tabs:reload', id),
  },
  onTabsUpdated: (cb) => {
    ipcRenderer.on('tabs:updated', (_e, snap) => cb(snap))
  },
  history: {
    search: (q) => ipcRenderer.invoke('history:search', q),
    list: () => ipcRenderer.invoke('history:list'),
  },
  bookmarks: {
    toggleActive: () => ipcRenderer.invoke('bookmarks:toggle-active'),
    list: () => ipcRenderer.invoke('bookmarks:list'),
  },
  downloads: {
    reveal: (id) => ipcRenderer.send('downloads:reveal', id),
    onUpdated: (cb) => {
      ipcRenderer.on('downloads:updated', (_e, list) => cb(list))
    },
  },
  ui: {
    setOverlayHeight: (px) => ipcRenderer.send('ui:set-overlay-height', px),
    onFocusUrlBar: (cb) => {
      ipcRenderer.on('ui:focus-urlbar', () => cb())
    },
    onToggleHistory: (cb) => {
      ipcRenderer.on('ui:toggle-history', () => cb())
    },
    onToggleBookmarks: (cb) => {
      ipcRenderer.on('ui:toggle-bookmarks', () => cb())
    },
  },
}

contextBridge.exposeInMainWorld('synapse', api)
