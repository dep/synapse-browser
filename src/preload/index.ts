import { contextBridge, ipcRenderer } from 'electron'
import type { SynapseApi } from '../shared/ipc'
import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'

const api: SynapseApi = {
  tabs: {
    create: (url) => ipcRenderer.send('tabs:create', url),
    close: (id) => ipcRenderer.send('tabs:close', id),
    activate: (id) => ipcRenderer.send('tabs:activate', id),
    navigate: (id, input) => ipcRenderer.send('tabs:navigate', id, input),
    back: (id) => ipcRenderer.send('tabs:back', id),
    forward: (id) => ipcRenderer.send('tabs:forward', id),
    reload: (id) => ipcRenderer.send('tabs:reload', id),
    reorder: (id, toIndex) => ipcRenderer.send('tabs:reorder', id, toIndex),
    showContextMenu: (id) => ipcRenderer.send('tabs:context-menu', id),
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
    open: (id) => ipcRenderer.send('bookmarks:open', id),
    remove: (id) => ipcRenderer.send('bookmarks:remove', id),
    rename: (id, title) => ipcRenderer.send('bookmarks:rename', id, title),
    reorder: (id, toIndex) => ipcRenderer.send('bookmarks:reorder', id, toIndex),
    moveToFolder: (id, folderId, toIndex) =>
      ipcRenderer.send('bookmarks:move-to-folder', id, folderId, toIndex),
    createFromTab: (tabId, folderId) =>
      ipcRenderer.send('bookmarks:create-from-tab', tabId, folderId),
    addFolder: (name) => ipcRenderer.send('bookmarks:add-folder', name),
    renameFolder: (id, name) => ipcRenderer.send('bookmarks:rename-folder', id, name),
    removeFolder: (id) => ipcRenderer.send('bookmarks:remove-folder', id),
    showContextMenu: (kind, id) => ipcRenderer.send('bookmarks:context-menu', kind, id),
  },
  downloads: {
    reveal: (id) => ipcRenderer.send('downloads:reveal', id),
    onUpdated: (cb) => {
      ipcRenderer.on('downloads:updated', (_e, list) => cb(list))
    },
  },
  shortcuts: {
    list: () => ipcRenderer.invoke('shortcuts:list'),
    set: (id, accelerator) => ipcRenderer.invoke('shortcuts:set', id, accelerator),
    reset: (id) => ipcRenderer.invoke('shortcuts:reset', id),
    resetAll: () => ipcRenderer.invoke('shortcuts:reset-all'),
    setRecording: (active) => ipcRenderer.send('shortcuts:recording', active),
  },
  ui: {
    setOverlayHeight: (px) => ipcRenderer.send('ui:set-overlay-height', px),
    startSidebarDrag: () => ipcRenderer.send('ui:sidebar-drag-start'),
    endSidebarDrag: () => ipcRenderer.send('ui:sidebar-drag-end'),
    onSidebarWidth: (cb) => {
      ipcRenderer.on('ui:sidebar-width', (_e, px) => cb(px))
    },
    onSidebarVisible: (cb) => {
      ipcRenderer.on('ui:sidebar-visible', (_e, visible) => cb(visible))
    },
    onSettings: (cb) => {
      ipcRenderer.on('ui:settings', (_e, open) => cb(open))
    },
    onFocusUrlBar: (cb) => {
      ipcRenderer.on('ui:focus-urlbar', () => cb())
    },
    onToggleHistory: (cb) => {
      ipcRenderer.on('ui:toggle-history', () => cb())
    },
    onBookmarksChanged: (cb) => {
      ipcRenderer.on('ui:bookmarks-changed', () => cb())
    },
    onEditFolder: (cb) => {
      ipcRenderer.on('ui:edit-folder', (_e, folderId) => cb(folderId))
    },
    onEditBookmark: (cb) => {
      ipcRenderer.on('ui:edit-bookmark', (_e, bookmarkId) => cb(bookmarkId))
    },
  },
}

contextBridge.exposeInMainWorld('synapse', api)

// registers <browser-action-list>; this preload only ever runs in the chrome
// UI window, never in web page tabs
injectBrowserAction()
