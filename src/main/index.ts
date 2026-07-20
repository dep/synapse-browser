import { app, dialog, ipcMain, Menu, session } from 'electron'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProfileId, ShortcutRow, SuggestionsPayload } from '../shared/ipc'
import { normalizeAccelerator } from '../shared/accelerator'
import { FIXED_SHORTCUTS, RESERVED_ACCELERATORS, SHORTCUT_COMMANDS } from '../shared/shortcuts'
import { parseBookmarksExport, planImport } from '../shared/bookmarks-io'
import { sanitizeMessages } from '../shared/ai'
import { AiChatController } from './ai'
import { BookmarksStore } from './bookmarks'
import { SettingsStore } from './settings-store'
import { DownloadManager } from './downloads'
import { ExtensionManager } from './extensions'
import { searchSuggestions } from '../shared/history-search'
import { topSitesFrom } from '../shared/newtab'
import { WeatherService } from './weather'
import { FaviconStore } from './favicons'
import { HistoryStore } from './history'
import { attachPermissionPrompts } from './media-permissions'
import { PermissionsStore } from './permissions-store'
import { PinsStore } from './pins-store'
import { ShortcutsStore } from './shortcuts-store'
import { WORK_PARTITION } from './tab-manager'
import { TabsStore } from './tabs-store'
import { UiStore } from './ui-store'
import { Updater } from './updater'
import { buildMenu } from './menu'
import { toChromeUserAgent } from '../shared/user-agent'
import {
  allBundles,
  bundleFor,
  bundleOwningTab,
  createWindow,
  detachTabToNewWindow,
  focusedBundle,
  primaryBundle,
} from './window'
import type { WindowBundle, WindowDeps } from './window'

// must run before any session exists so every partition inherits it
app.userAgentFallback = toChromeUserAgent(app.userAgentFallback, app.getName(), app.getVersion())

// relocating userData also moves the single-instance lock, letting a dev
// instance run alongside the installed app
const userDataOverride = process.env['SYNAPSE_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

// as the default browser, links clicked in other apps launch a new process;
// route them into the existing window instead of spawning duplicate ones
if (!app.requestSingleInstanceLock()) app.quit()

let openUrlInExistingWindow: ((url: string) => void) | null = null
const pendingUrls: string[] = []

function handleLaunchUrl(url: string): void {
  if (openUrlInExistingWindow) openUrlInExistingWindow(url)
  else pendingUrls.push(url)
}

// macOS delivers link-open requests via this event, not argv
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleLaunchUrl(url)
})

app.on('second-instance', (_e, argv) => {
  const url = argv.find((a) => /^https?:\/\//.test(a))
  if (url) handleLaunchUrl(url)
})

app.whenReady().then(async () => {
  // in dev the Dock shows the stock Electron icon; a packaged app gets icon.icns
  const dockIcon = join(app.getAppPath(), 'resources/icon.png')
  if (existsSync(dockIcon)) app.dock?.setIcon(dockIcon)

  // lets macOS list Synapse under System Settings > Desktop & Dock > Default web browser
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('http')
    app.setAsDefaultProtocolClient('https')
  }

  const userData = app.getPath('userData')
  // productName renamed the userData dir; pull stores from the pre-rename one
  const legacyDir = join(app.getPath('appData'), 'synapse-browser')
  for (const f of ['history.json', 'bookmarks.json', 'pins.json']) {
    const src = join(legacyDir, f)
    const dst = join(userData, f)
    if (src !== dst && existsSync(src) && !existsSync(dst)) copyFileSync(src, dst)
  }
  const history = new HistoryStore(userData)
  const favicons = new FaviconStore(userData)
  const bookmarks = new BookmarksStore(userData)
  const tabsStore = new TabsStore(userData)
  const pinsStore = new PinsStore(userData)
  const uiStore = new UiStore(userData)
  const shortcutsStore = new ShortcutsStore(userData)
  const permissionsStore = new PermissionsStore(userData)
  const settingsStore = new SettingsStore(userData)
  const weather = new WeatherService()

  // IPC only ever arrives from a window's chrome renderer or its suggestions
  // overlay; the registry maps either back to the owning window's bundle
  const forSender = (
    e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
  ): WindowBundle | null => bundleFor(e.sender)
  const targetBundle = (): WindowBundle | null => focusedBundle() ?? primaryBundle()

  const extensions = new ExtensionManager({
    forTabWc: (wc) => bundleOwningTab(wc)?.tabs ?? null,
    target: () => {
      const b = targetBundle()
      return b && { tabs: b.tabs, win: b.win }
    },
  })

  let sessionRestored = false
  const bookmarksChanged = (): void => {
    const p = primaryBundle()
    if (!p) return
    p.tabs.syncBookmarks(bookmarks.ordered())
    p.win.webContents.send('ui:bookmarks-changed')
  }
  const deps: WindowDeps = {
    history,
    favicons,
    bookmarks,
    tabsStore,
    pinsStore,
    uiStore,
    extensions,
    bookmarksChanged,
    isSessionRestored: () => sessionRestored,
  }

  const primary = createWindow('primary', deps)

  const updater = new Updater(primary.win)
  // silent launch check; dev builds check only via the menu
  if (app.isPackaged) setTimeout(() => void updater.check(false), 10_000)

  const toggleSidebar = (b: WindowBundle): void => {
    b.sidebarVisible = !b.sidebarVisible
    uiStore.setSidebarVisible(b.sidebarVisible)
    b.tabs.setSidebarVisible(b.sidebarVisible)
    b.win.webContents.send('ui:sidebar-visible', b.sidebarVisible)
  }
  const toggleAiSidebar = (b: WindowBundle): void => {
    if (b.role !== 'primary') return // secondaries have no AI sidebar
    b.aiVisible = !b.aiVisible
    uiStore.setAiSidebarVisible(b.aiVisible)
    b.tabs.setAiSidebarVisible(b.aiVisible)
    b.win.webContents.send('ui:ai-visible', b.aiVisible)
  }
  const toggleSettings = (b: WindowBundle): void => {
    b.win.webContents.send('ui:settings', b.tabs.toggleSettings())
  }

  const ai = new AiChatController({
    getSettings: () => ({ apiKey: settingsStore.aiApiKey(), model: settingsStore.aiModel() }),
    // the AI sidebar lives in the primary window only
    getActivePage: () => {
      const b = primaryBundle()
      return b?.tabs.activeId ? b.tabs.webContentsFor(b.tabs.activeId) : null
    },
    send: (channel, payload) => primaryBundle()?.win.webContents.send(channel, payload),
  })

  openUrlInExistingWindow = (url) => {
    const b = targetBundle()
    if (!b) return
    b.tabs.createTab(url)
    if (b.win.isMinimized()) b.win.restore()
    b.win.focus()
  }
  for (const url of pendingUrls.splice(0)) openUrlInExistingWindow(url)

  // the downloads shelf list is app-global, so every window's chrome renders it
  const downloads = new DownloadManager((list) => {
    for (const b of allBundles()) b.win.webContents.send('downloads:updated', list)
  })
  downloads.attach(session.defaultSession)
  // the Work container: isolated cookies/storage/cache, persisted across runs.
  // No extensions are loaded into it and no webRequest handlers are registered
  // (repo rule). Created eagerly so downloads work before any Work tab exists.
  const workSession = session.fromPartition(WORK_PARTITION)
  downloads.attach(workSession)
  // mic/camera requests prompt per origin (persisted); both containers.
  // The dialog parents to the window owning the requesting tab.
  const promptParent = (wc: Electron.WebContents): Electron.BrowserWindow | null =>
    bundleOwningTab(wc)?.win ?? primaryBundle()?.win ?? null
  attachPermissionPrompts(session.defaultSession, promptParent, permissionsStore)
  attachPermissionPrompts(workSession, promptParent, permissionsStore)
  ipcMain.on('downloads:reveal', (_e, id: string) => downloads.reveal(id))

  ipcMain.on('tabs:create', (e, url?: string) => {
    forSender(e)?.tabs.createTab(typeof url === 'string' ? url : undefined)
  })
  ipcMain.on('tabs:close', (e, id: string) => forSender(e)?.tabs.closeTab(id))
  ipcMain.on('tabs:activate', (e, id: string) => forSender(e)?.tabs.activateTab(id))
  ipcMain.on('tabs:navigate', (e, id: string, input: string) =>
    forSender(e)?.tabs.navigate(id, String(input)),
  )
  ipcMain.on('tabs:back', (e, id: string) => forSender(e)?.tabs.back(id))
  ipcMain.on('tabs:forward', (e, id: string) => forSender(e)?.tabs.forward(id))
  ipcMain.on('tabs:reload', (e, id: string) => forSender(e)?.tabs.reload(id))
  ipcMain.on('tabs:nav-new-tab', (e, id: string, offset: number) => {
    if (typeof id === 'string' && (offset === -1 || offset === 0 || offset === 1))
      forSender(e)?.tabs.openNavInNewTab(id, offset)
  })
  ipcMain.on('tabs:stop', (e, id: string) => forSender(e)?.tabs.stop(id))
  ipcMain.on('tabs:reorder', (e, id: string, toIndex: number, group?: unknown) => {
    if (typeof id !== 'string') return
    if (group !== undefined && group !== null && typeof group !== 'string') return
    forSender(e)?.tabs.reorderTab(id, Number(toIndex), group)
  })
  ipcMain.on('tabs:rename', (e, id: string, title: string) => {
    if (typeof id === 'string' && typeof title === 'string')
      forSender(e)?.tabs.renameTab(id, title)
  })
  ipcMain.on('tabs:open-in-split', (e, id: string) => {
    if (typeof id === 'string') forSender(e)?.tabs.openInSplit(id)
  })
  // a pane ✕ button's overlay document isn't in the chrome-renderer registry;
  // each window's TabManager knows which overlays it owns
  ipcMain.on('pane:close', (e) => {
    for (const b of allBundles()) if (b.tabs.closePaneFromOverlay(e.sender)) return
  })
  ipcMain.on('tabs:detach', (e, id: string, x: number, y: number) => {
    const b = forSender(e)
    if (!b || typeof id !== 'string' || !Number.isFinite(x) || !Number.isFinite(y)) return
    detachTabToNewWindow(b, id, x, y, deps)
  })

  ipcMain.on('tabs:context-menu', (e, id: string) => {
    const b = forSender(e)
    if (!b || typeof id !== 'string') return
    const pinned = b.tabs.isPinned(id)
    const profile = b.tabs.profileOf(id)
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: pinned ? 'Unpin Tab' : 'Pin Tab',
        click: () => b.tabs.togglePin(id),
      },
    ]
    if (pinned && b.tabs.isAwake(id)) {
      template.push({ label: 'Restore Pinned URL', click: () => b.tabs.restoreAnchor(id) })
    }
    template.push(
      { type: 'separator' },
      {
        label: 'Profile',
        submenu: [
          {
            label: 'Default',
            type: 'radio',
            checked: profile === 'default',
            click: () => b.tabs.setProfile(id, 'default'),
          },
          {
            label: 'Work',
            type: 'radio',
            checked: profile === 'work',
            click: () => b.tabs.setProfile(id, 'work'),
          },
        ],
      },
    )
    if (b.tabs.groupOf(id)) {
      template.push({ label: 'Remove from Group', click: () => b.tabs.ungroupTab(id) })
    }
    template.push(
      { type: 'separator' },
      // closing a pin puts it to sleep; the slot stays in the row
      { label: pinned ? 'Close' : 'Close Tab', click: () => b.tabs.closeTab(id) },
    )
    Menu.buildFromTemplate(template).popup({ window: b.win })
  })

  // ── tab groups (issue #31) ─────────────────────────────────────────────

  // "bookmark the group": the group becomes a bookmark folder and each
  // member becomes that folder's bookmark slot in place (the same conversion
  // as dragging a single tab into the bookmarks section)
  const saveGroupToBookmarks = (b: WindowBundle, gid: string): void => {
    if (b.role !== 'primary') return // secondaries render no bookmarks
    const info = b.tabs.groupInfo(gid)
    if (!info) return
    const members = b.tabs.groupTabIds(gid)
    if (members.length === 0) return
    const folder = bookmarks.addFolder(info.name, info.profile)
    for (const tid of members) {
      const page = b.tabs.infoFor(tid)
      if (!page || !/^https?:\/\//.test(page.url)) continue // blank/error tabs stay tabs
      const bm = bookmarks.add(page.url, page.title, Date.now(), b.tabs.profileOf(tid))
      b.tabs.bookmarkTab(tid, bm.id)
      bookmarks.moveToFolder(bm.id, folder.id)
    }
    // members left the tab list, so the group reaps itself at the next snapshot
    bookmarksChanged()
  }

  ipcMain.handle('groups:create', (e) => forSender(e)?.tabs.createGroupWithTab() ?? null)
  ipcMain.on('groups:create-from-drop', (e, targetId: string, draggedId: string) => {
    if (typeof targetId === 'string' && typeof draggedId === 'string')
      forSender(e)?.tabs.groupFromDrop(targetId, draggedId)
  })
  ipcMain.on('groups:close', (e, id: string) => {
    if (typeof id === 'string') forSender(e)?.tabs.closeGroup(id)
  })
  ipcMain.on('groups:ungroup', (e, id: string) => {
    if (typeof id === 'string') forSender(e)?.tabs.ungroup(id)
  })
  ipcMain.on('groups:remove-tab', (e, tabId: string) => {
    if (typeof tabId === 'string') forSender(e)?.tabs.ungroupTab(tabId)
  })
  ipcMain.on('groups:rename', (e, id: string, name: string) => {
    if (typeof id === 'string' && typeof name === 'string') forSender(e)?.tabs.renameGroup(id, name)
  })
  ipcMain.on('groups:reorder', (e, id: string, toIndex: number) => {
    if (typeof id === 'string') forSender(e)?.tabs.moveGroup(id, Number(toIndex))
  })
  ipcMain.on('groups:save-to-bookmarks', (e, id: string) => {
    const b = forSender(e)
    if (b && typeof id === 'string') saveGroupToBookmarks(b, id)
  })
  ipcMain.on('groups:context-menu', (e, id: string) => {
    const b = forSender(e)
    if (!b || typeof id !== 'string') return
    const info = b.tabs.groupInfo(id)
    if (!info) return
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'Rename', click: () => b.win.webContents.send('ui:edit-group', id) },
      {
        label: 'Profile',
        submenu: [
          {
            label: 'Default',
            type: 'radio',
            checked: info.profile === 'default',
            click: () => b.tabs.setGroupProfile(id, 'default'),
          },
          {
            label: 'Work',
            type: 'radio',
            checked: info.profile === 'work',
            click: () => b.tabs.setGroupProfile(id, 'work'),
          },
        ],
      },
      { type: 'separator' },
    ]
    if (b.role === 'primary') {
      template.push({ label: 'Save Group to Bookmarks', click: () => saveGroupToBookmarks(b, id) })
    }
    template.push(
      { label: 'Ungroup Tabs', click: () => b.tabs.ungroup(id) },
      { type: 'separator' },
      { label: 'Close Group', click: () => b.tabs.closeGroup(id) },
    )
    Menu.buildFromTemplate(template).popup({ window: b.win })
  })

  // suggestions blend shared history with the active tab's own profile's
  // bookmarks — a Work bookmark suggested to a default tab would load the
  // Work URL in the default session
  ipcMain.handle('history:search', (e, q: string) => {
    const b = forSender(e)
    const profile = b?.tabs.activeId ? b.tabs.profileOf(b.tabs.activeId) : 'default'
    const marks = bookmarks.ordered().filter((bm) => (bm.profile ?? 'default') === profile)
    return searchSuggestions(history.entries(), marks, String(q), Date.now()).map((s) =>
      s.favicon ? s : { ...s, favicon: favicons.get(s.url) },
    )
  })
  ipcMain.handle('history:list', () => history.list())
  ipcMain.handle('newtab:data', () => {
    const entries = history.entries()
    return {
      entries,
      topSites: topSitesFrom(entries, Date.now()),
      favicons: favicons.all(),
      weather: weather.cached(),
    }
  })
  ipcMain.handle('newtab:weather', () => weather.get())

  // ⌘D / ☆: convert the active tab into a bookmark, or a bookmark tab back
  const toggleBookmark = (b: WindowBundle): void => {
    const tid = b.tabs.activeId
    if (!tid) return
    if (b.role === 'secondary') {
      // secondaries have no bookmark slots; ⌘D just files the page into the
      // global store (rendered by the primary window)
      const info = b.tabs.infoFor(tid)
      if (!info || !/^https?:\/\//.test(info.url)) return
      const profile = b.tabs.profileOf(tid)
      const exists = bookmarks
        .ordered()
        .some((bm) => bm.url === info.url && (bm.profile ?? 'default') === profile)
      if (exists) return
      bookmarks.add(info.url, info.title, Date.now(), profile)
      bookmarksChanged()
      return
    }
    const bid = b.tabs.bookmarkIdOf(tid)
    if (bid) {
      bookmarks.remove(bid)
      b.tabs.unbookmarkTab(bid)
    } else {
      if (b.tabs.isPinned(tid)) return // pins aren't convertible to bookmarks
      const info = b.tabs.activeInfo()
      if (!info || !/^https?:\/\//.test(info.url)) return
      const bm = bookmarks.add(info.url, info.title, Date.now(), b.tabs.profileOf(tid))
      b.tabs.bookmarkTab(tid, bm.id)
    }
    bookmarksChanged()
  }

  const exportBookmarks = async (): Promise<void> => {
    const date = new Date().toISOString().slice(0, 10)
    const opts: Electron.SaveDialogOptions = {
      defaultPath: `synapse-bookmarks-${date}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    }
    const parent = targetBundle()?.win
    const { canceled, filePath } = parent
      ? await dialog.showSaveDialog(parent, opts)
      : await dialog.showSaveDialog(opts)
    if (canceled || !filePath) return
    writeFileSync(filePath, JSON.stringify({ v: 1, ...bookmarks.list() }, null, 2))
  }

  const messageBox = (opts: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> => {
    const parent = targetBundle()?.win
    return parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts)
  }

  const importBookmarks = async (): Promise<void> => {
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    }
    const parent = targetBundle()?.win
    const { canceled, filePaths } = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
    if (canceled || !filePaths[0]) return
    let text: string
    try {
      text = readFileSync(filePaths[0], 'utf8')
    } catch {
      void messageBox({ type: 'error', message: 'Could not read that file.' })
      return
    }
    const incoming = parseBookmarksExport(text)
    if (!incoming) {
      void messageBox({ type: 'error', message: 'Not a Synapse bookmarks export file.' })
      return
    }
    const plan = planImport(bookmarks.list(), incoming)
    const folderIds = new Map(bookmarks.list().folders.map((f) => [f.name, f.id]))
    for (const f of plan.folders) folderIds.set(f.name, bookmarks.addFolder(f.name, f.profile).id)
    for (const item of plan.bookmarks) {
      const created = bookmarks.add(item.url, item.title, Date.now(), item.profile)
      if (item.folderName) {
        const fid = folderIds.get(item.folderName)
        if (fid) bookmarks.moveToFolder(created.id, fid)
      }
    }
    bookmarksChanged()
    const n = plan.bookmarks.length
    void messageBox({
      type: 'info',
      message: `Imported ${n} bookmark${n === 1 ? '' : 's'}${
        plan.skipped ? ` (${plan.skipped} skipped as duplicates)` : ''
      }.`,
    })
  }
  ipcMain.handle('bookmarks:toggle-active', (e) => {
    const b = forSender(e)
    if (b) toggleBookmark(b)
  })
  ipcMain.handle('bookmarks:list', () => bookmarks.list())

  // drag a sidebar tab into the bookmarks panel or a folder
  ipcMain.on('bookmarks:create-from-tab', (e, tabId: string, folderId: string | null) => {
    const b = forSender(e)
    if (!b || typeof tabId !== 'string') return
    if (folderId !== null && typeof folderId !== 'string') return
    if (b.tabs.isPinned(tabId) || b.tabs.bookmarkIdOf(tabId)) return
    const info = b.tabs.infoFor(tabId)
    if (!info || !/^https?:\/\//.test(info.url)) return
    const bm = bookmarks.add(info.url, info.title, Date.now(), b.tabs.profileOf(tabId))
    b.tabs.bookmarkTab(tabId, bm.id)
    if (folderId) bookmarks.moveToFolder(bm.id, folderId)
    bookmarksChanged()
  })

  ipcMain.on('bookmarks:open', (e, id: string) => {
    if (typeof id === 'string') forSender(e)?.tabs.openBookmark(id)
  })
  ipcMain.on('bookmarks:remove', (_e, id: string) => {
    if (typeof id !== 'string') return
    bookmarks.remove(id)
    bookmarksChanged()
  })
  ipcMain.on('bookmarks:rename', (_e, id: string, title: string) => {
    const trimmed = typeof title === 'string' ? title.trim() : ''
    if (typeof id !== 'string' || !trimmed) return
    bookmarks.renameBookmark(id, trimmed)
    bookmarksChanged()
  })
  ipcMain.on('bookmarks:reorder', (_e, id: string, toIndex: number) => {
    if (typeof id !== 'string' || !Number.isFinite(Number(toIndex))) return
    bookmarks.reorder(id, Number(toIndex))
    bookmarksChanged()
  })
  ipcMain.on(
    'bookmarks:move-to-folder',
    (_e, id: string, folderId: string | null, toIndex?: number) => {
      if (typeof id !== 'string') return
      if (folderId !== null && typeof folderId !== 'string') return
      const idx = toIndex === undefined ? undefined : Number(toIndex)
      if (idx !== undefined && !Number.isFinite(idx)) return
      bookmarks.moveToFolder(id, folderId, idx)
      bookmarksChanged()
    },
  )
  ipcMain.on('bookmarks:add-folder', (_e, name: string) => {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) return
    bookmarks.addFolder(trimmed)
    bookmarksChanged()
  })
  ipcMain.on('bookmarks:rename-folder', (_e, id: string, name: string) => {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (typeof id !== 'string' || !trimmed) return
    bookmarks.renameFolder(id, trimmed)
    bookmarksChanged()
  })

  // deleting a non-empty folder destroys its bookmarks and has no undo
  const removeFolderWithConfirm = async (folderId: string): Promise<void> => {
    const { folders, bookmarks: all } = bookmarks.list()
    const folder = folders.find((f) => f.id === folderId)
    if (!folder) return
    const count = all.filter((b) => b.folderId === folderId).length
    if (count > 0) {
      const { response } = await messageBox({
        type: 'warning',
        buttons: ['Delete', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Delete "${folder.name}" and its ${count} bookmark${count === 1 ? '' : 's'}?`,
      })
      if (response !== 0) return
    }
    bookmarks.removeFolder(folderId)
    bookmarksChanged()
  }
  ipcMain.on('bookmarks:remove-folder', (_e, id: string) => {
    if (typeof id === 'string') void removeFolderWithConfirm(id)
  })

  ipcMain.on('bookmarks:context-menu', (e, kind: string, id: string) => {
    const b = forSender(e)
    if (!b || typeof id !== 'string') return
    if (kind === 'folder') {
      const folder = bookmarks.list().folders.find((f) => f.id === id)
      if (!folder) return
      const setFolderProfile = (profile: ProfileId) => () => {
        bookmarks.setFolderProfile(id, profile)
        // members inherit through the store; awake member tabs must move
        // partitions now, asleep slots re-read the store on wake — setProfile
        // handles both (an asleep slot just updates its profile map entry)
        for (const bm of bookmarks.list().bookmarks) {
          if (bm.folderId !== id) continue
          const tid = b.tabs.bookmarkTabIdOf(bm.id)
          if (tid) b.tabs.setProfile(tid, bm.profile ?? 'default')
        }
        bookmarksChanged()
      }
      Menu.buildFromTemplate([
        { label: 'Rename', click: () => b.win.webContents.send('ui:edit-folder', id) },
        {
          label: 'Profile',
          submenu: [
            {
              label: 'Default',
              type: 'radio',
              checked: (folder.profile ?? 'default') === 'default',
              click: setFolderProfile('default'),
            },
            {
              label: 'Work',
              type: 'radio',
              checked: folder.profile === 'work',
              click: setFolderProfile('work'),
            },
          ],
        },
        { label: 'Delete Folder…', click: () => void removeFolderWithConfirm(id) },
      ]).popup({ window: b.win })
    } else if (kind === 'bookmark') {
      const { folders, bookmarks: all } = bookmarks.list()
      const bm = all.find((x) => x.id === id)
      if (!bm) return
      const tid = b.tabs.bookmarkTabIdOf(id)
      const awake = tid !== null && b.tabs.isAwake(tid)
      const currentUrl = awake ? b.tabs.webContentsFor(tid!)?.getURL() : undefined
      const moveTo = (folderId: string | null) => () => {
        bookmarks.moveToFolder(id, folderId)
        bookmarksChanged()
      }
      const setProfile = (profile: ProfileId) => () => {
        bookmarks.setProfile(id, profile)
        // an awake tab must move partitions now; asleep slots pick the
        // profile up from the store on wake. The tab follows the effective
        // profile — a folder's profile still applies when the bookmark's own
        // setting is cleared back to default
        if (awake) b.tabs.setProfile(tid!, bookmarks.get(id)?.profile ?? 'default')
        bookmarksChanged()
      }
      const template: Electron.MenuItemConstructorOptions[] = [
        { label: 'Rename', click: () => b.win.webContents.send('ui:edit-bookmark', id) },
        {
          label: 'Move to',
          submenu: [
            { label: 'Top Level', type: 'radio', checked: !bm.folderId, click: moveTo(null) },
            ...folders.map(
              (f): Electron.MenuItemConstructorOptions => ({
                label: f.name,
                type: 'radio',
                checked: bm.folderId === f.id,
                click: moveTo(f.id),
              }),
            ),
          ],
        },
        { type: 'separator' },
        {
          label: 'Profile',
          submenu: [
            {
              label: 'Default',
              type: 'radio',
              checked: (bm.profile ?? 'default') === 'default',
              click: setProfile('default'),
            },
            {
              label: 'Work',
              type: 'radio',
              checked: bm.profile === 'work',
              click: setProfile('work'),
            },
          ],
        },
      ]
      if (awake && currentUrl !== bm.url) {
        template.push({ label: 'Restore Bookmarked URL', click: () => b.tabs.restoreAnchor(tid) })
      }
      if (awake) {
        template.push({ label: 'Put to Sleep', click: () => b.tabs.closeTab(tid!) })
      }
      template.push(
        { type: 'separator' },
        {
          label: 'Delete Bookmark',
          click: () => {
            bookmarks.remove(id)
            bookmarksChanged()
          },
        },
      )
      Menu.buildFromTemplate(template).popup({ window: b.win })
    }
  })

  const rebuildMenu = (): void =>
    buildMenu({
      bundle: targetBundle,
      extensions,
      shortcuts: shortcutsStore.resolved(),
      commands: {
        newWindow: () => void createWindow('secondary', deps),
        toggleBookmark,
        toggleSidebar,
        toggleAiSidebar,
        toggleSettings,
        exportBookmarks: () => void exportBookmarks(),
        importBookmarks: () => void importBookmarks(),
        checkForUpdates: () => void updater.check(true),
      },
    })
  rebuildMenu()
  // the Tools → Extensions submenu lists installed extensions; rebuild it as they change
  session.defaultSession.on('extension-loaded', rebuildMenu)
  session.defaultSession.on('extension-unloaded', rebuildMenu)

  const isMac = process.platform === 'darwin'
  ipcMain.handle('shortcuts:list', (): ShortcutRow[] => {
    const resolved = shortcutsStore.resolved()
    return [
      ...SHORTCUT_COMMANDS.map((c) => ({
        id: c.id,
        label: c.label,
        accelerator: resolved[c.id]!,
        default: c.default,
        fixed: false,
      })),
      ...FIXED_SHORTCUTS.map((f) => ({
        id: f.id,
        label: f.label,
        accelerator: f.accelerator,
        default: f.accelerator,
        fixed: true,
      })),
    ]
  })
  ipcMain.handle('shortcuts:set', (_e, id: string, accelerator: string) => {
    if (typeof id !== 'string' || typeof accelerator !== 'string' || !accelerator) {
      return { ok: false, error: 'Invalid shortcut.' }
    }
    const command = SHORTCUT_COMMANDS.find((c) => c.id === id)
    if (!command) return { ok: false, error: 'Unknown command.' }
    const wanted = normalizeAccelerator(accelerator, isMac)
    if (RESERVED_ACCELERATORS.has(wanted)) {
      return { ok: false, error: 'Reserved by the system.' }
    }
    const resolved = shortcutsStore.resolved()
    for (const other of SHORTCUT_COMMANDS) {
      if (other.id !== id && normalizeAccelerator(resolved[other.id]!, isMac) === wanted) {
        return { ok: false, error: `Already used by “${other.label}”.` }
      }
    }
    if (wanted === normalizeAccelerator(command.default, isMac)) shortcutsStore.reset(id)
    else shortcutsStore.set(id, accelerator)
    rebuildMenu()
    return { ok: true }
  })
  ipcMain.handle('shortcuts:reset', (_e, id: string) => {
    if (typeof id === 'string') {
      shortcutsStore.reset(id)
      rebuildMenu()
    }
  })
  ipcMain.handle('shortcuts:reset-all', () => {
    shortcutsStore.resetAll()
    rebuildMenu()
  })
  // while the settings recorder is capturing a chord, menu accelerators must
  // not fire — otherwise pressing a bound chord executes the command (e.g.
  // Cmd+W closes the tab) instead of being recorded. Gate every window: the
  // chord would fire globally regardless of which window records it.
  ipcMain.on('shortcuts:recording', (_e, active: boolean) => {
    for (const b of allBundles()) b.win.webContents.setIgnoreMenuShortcuts(active === true)
  })

  // ext menu only; the suggestions dropdown is a native overlay view (sugg:*)
  ipcMain.on('ui:set-overlay-height', (e, px: number) =>
    forSender(e)?.tabs.setOverlayHeight(Number(px) || 0),
  )

  ipcMain.on('sugg:update', (e, p: SuggestionsPayload) => {
    if (!p || !Array.isArray(p.items) || !p.anchor) return
    forSender(e)?.suggestions.update(p)
  })
  ipcMain.on('sugg:height', (e, px: number, gen: number) =>
    forSender(e)?.suggestions.setHeight(Number(px) || 0, Number(gen) || 0),
  )
  ipcMain.on('sugg:pick', (e, url: string) => {
    const b = forSender(e)
    if (!b) return
    // chrome blurs and clears first — the dropdown must never stay stuck open
    b.win.webContents.send('sugg:picked')
    if (typeof url !== 'string' || !b.tabs.activeId) return
    b.tabs.navigate(b.tabs.activeId, url)
    // clicking the overlay focused its webContents; hand focus to the page
    b.tabs.webContentsFor(b.tabs.activeId)?.focus()
  })
  ipcMain.on('ui:sidebar-drag-start', (e) => forSender(e)?.sidebarResize.start())
  ipcMain.on('ui:sidebar-drag-end', (e) => forSender(e)?.sidebarResize.end())
  ipcMain.on('ui:ai-drag-start', (e) => forSender(e)?.aiSidebarResize.start())
  ipcMain.on('ui:ai-drag-end', (e) => forSender(e)?.aiSidebarResize.end())

  ipcMain.on('ui:toggle-ai', (e) => {
    const b = forSender(e)
    if (b) toggleAiSidebar(b)
  })

  // the AI sidebar's "Open Settings" shortcut must open, never close
  ipcMain.on('ui:open-settings', (e) => {
    const b = forSender(e)
    if (b && !b.tabs.isSettingsOpen()) toggleSettings(b)
  })

  ipcMain.handle('settings:get', () => ({
    apiKey: settingsStore.aiApiKey(),
    model: settingsStore.aiModel(),
  }))
  ipcMain.handle('settings:set', (_e, patch: { apiKey?: unknown; model?: unknown }) => {
    if (typeof patch?.apiKey === 'string') settingsStore.setAiApiKey(patch.apiKey.trim())
    if (typeof patch?.model === 'string') settingsStore.setAiModel(patch.model)
  })

  ipcMain.on('ai:send', (_e, messages: unknown) => void ai.start(sanitizeMessages(messages)))
  ipcMain.on('ai:stop', () => ai.stop())

  ipcMain.on('find:start', (e, text: string) => {
    if (typeof text === 'string') forSender(e)?.tabs.findStart(text)
  })
  ipcMain.on('find:step', (e, dir: number) => forSender(e)?.tabs.findStep(dir === -1 ? -1 : 1))
  ipcMain.on('find:stop', (e) => forSender(e)?.tabs.findStop())

  try {
    await extensions.init()
  } catch (err) {
    console.error('extensions: startup failed, continuing without extensions', err)
  }
  primary.tabs.restorePins(pinsStore.load())
  primary.tabs.syncBookmarks(bookmarks.ordered())
  const saved = tabsStore.load()
  primary.tabs.restoreTabs(saved.tabs, saved.active, saved.groups)
  sessionRestored = true
  primary.tabs.refresh() // persist the restored state now that saves are unblocked

  app.on('before-quit', () => {
    history.flush()
    favicons.flush()
    bookmarks.flush()
    tabsStore.flush()
    pinsStore.flush()
    uiStore.flush()
    shortcutsStore.flush()
    permissionsStore.flush()
    settingsStore.flush()
  })
})

app.on('window-all-closed', () => app.quit())
