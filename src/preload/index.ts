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
    openNavInNewTab: (id, offset) => ipcRenderer.send('tabs:nav-new-tab', id, offset),
    stop: (id) => ipcRenderer.send('tabs:stop', id),
    reorder: (id, toIndex, group) => ipcRenderer.send('tabs:reorder', id, toIndex, group),
    rename: (id, title) => ipcRenderer.send('tabs:rename', id, title),
    detach: (id, screenX, screenY) => ipcRenderer.send('tabs:detach', id, screenX, screenY),
    openInSplit: (id) => ipcRenderer.send('tabs:open-in-split', id),
    showContextMenu: (id, selection) => ipcRenderer.send('tabs:context-menu', id, selection),
  },
  groups: {
    create: () => ipcRenderer.invoke('groups:create'),
    createFromDrop: (targetId, draggedId) =>
      ipcRenderer.send('groups:create-from-drop', targetId, draggedId),
    close: (id) => ipcRenderer.send('groups:close', id),
    ungroup: (id) => ipcRenderer.send('groups:ungroup', id),
    rename: (id, name) => ipcRenderer.send('groups:rename', id, name),
    reorder: (id, toIndex) => ipcRenderer.send('groups:reorder', id, toIndex),
    removeTab: (tabId) => ipcRenderer.send('groups:remove-tab', tabId),
    saveToBookmarks: (id) => ipcRenderer.send('groups:save-to-bookmarks', id),
    showContextMenu: (id) => ipcRenderer.send('groups:context-menu', id),
  },
  onTabsUpdated: (cb) => {
    ipcRenderer.on('tabs:updated', (_e, snap) => cb(snap))
  },
  suggestions: {
    update: (p) => ipcRenderer.send('sugg:update', p),
    onPicked: (cb) => {
      ipcRenderer.on('sugg:picked', () => cb())
    },
  },
  history: {
    search: (q) => ipcRenderer.invoke('history:search', q),
    list: () => ipcRenderer.invoke('history:list'),
  },
  newtab: {
    data: () => ipcRenderer.invoke('newtab:data'),
    weather: () => ipcRenderer.invoke('newtab:weather'),
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
  find: {
    start: (text) => ipcRenderer.send('find:start', text),
    step: (dir) => ipcRenderer.send('find:step', dir),
    stop: () => ipcRenderer.send('find:stop'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    open: () => ipcRenderer.send('ui:open-settings'),
  },
  ai: {
    send: (messages) => ipcRenderer.send('ai:send', messages),
    stop: () => ipcRenderer.send('ai:stop'),
    toggleSidebar: () => ipcRenderer.send('ui:toggle-ai'),
    onDelta: (cb) => {
      ipcRenderer.on('ai:delta', (_e, text) => cb(text))
    },
    onDone: (cb) => {
      ipcRenderer.on('ai:done', () => cb())
    },
    onError: (cb) => {
      ipcRenderer.on('ai:error', (_e, message) => cb(message))
    },
  },
  ui: {
    setOverlayHeight: (px) => ipcRenderer.send('ui:set-overlay-height', px),
    startSidebarDrag: () => ipcRenderer.send('ui:sidebar-drag-start'),
    endSidebarDrag: () => ipcRenderer.send('ui:sidebar-drag-end'),
    startAiSidebarDrag: () => ipcRenderer.send('ui:ai-drag-start'),
    endAiSidebarDrag: () => ipcRenderer.send('ui:ai-drag-end'),
    onSidebarWidth: (cb) => {
      ipcRenderer.on('ui:sidebar-width', (_e, px) => cb(px))
    },
    onSidebarVisible: (cb) => {
      ipcRenderer.on('ui:sidebar-visible', (_e, visible) => cb(visible))
    },
    onAiSidebarWidth: (cb) => {
      ipcRenderer.on('ui:ai-width', (_e, px) => cb(px))
    },
    onAiSidebarVisible: (cb) => {
      ipcRenderer.on('ui:ai-visible', (_e, visible) => cb(visible))
    },
    onSettings: (cb) => {
      ipcRenderer.on('ui:settings', (_e, open) => cb(open))
    },
    onFindOpen: (cb) => {
      ipcRenderer.on('ui:find-open', () => cb())
    },
    onFindStep: (cb) => {
      ipcRenderer.on('ui:find-step', (_e, dir) => cb(dir))
    },
    onFindResult: (cb) => {
      ipcRenderer.on('ui:find-result', (_e, r) => cb(r))
    },
    onFocusUrlBar: (cb) => {
      ipcRenderer.on('ui:focus-urlbar', () => cb())
    },
    onPaneRects: (cb) => {
      ipcRenderer.on('ui:pane-rects', (_e, rects) => cb(rects))
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
    onEditGroup: (cb) => {
      ipcRenderer.on('ui:edit-group', (_e, groupId) => cb(groupId))
    },
  },
}

contextBridge.exposeInMainWorld('synapse', api)

// registers <browser-action-list>; this preload only ever runs in the chrome
// UI window, never in web page tabs
injectBrowserAction()
