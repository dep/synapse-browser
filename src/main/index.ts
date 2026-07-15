import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron'
import type { WebContents } from 'electron'
import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProfileId, ShortcutRow } from '../shared/ipc'
import { normalizeAccelerator } from '../shared/accelerator'
import { FIXED_SHORTCUTS, RESERVED_ACCELERATORS, SHORTCUT_COMMANDS } from '../shared/shortcuts'
import { parseBookmarksExport, planImport } from '../shared/bookmarks-io'
import { clampAiSidebarWidth, sanitizeMessages } from '../shared/ai'
import { AiChatController } from './ai'
import { BookmarksStore } from './bookmarks'
import { SettingsStore } from './settings-store'
import { DownloadManager } from './downloads'
import { ExtensionManager } from './extensions'
import { searchSuggestions } from '../shared/history-search'
import { FaviconStore } from './favicons'
import { HistoryStore } from './history'
import { attachPermissionPrompts } from './media-permissions'
import { PermissionsStore } from './permissions-store'
import { PinsStore } from './pins-store'
import { SidebarResizeController } from './sidebar-resize'
import { ShortcutsStore } from './shortcuts-store'
import { TabManager, WORK_PARTITION } from './tab-manager'
import { TabsStore } from './tabs-store'
import { UiStore } from './ui-store'
import { Updater } from './updater'
import { buildMenu } from './menu'
import { attachPageContextMenu } from './page-context-menu-host'
import { toChromeUserAgent } from '../shared/user-agent'

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

  function attachCycleHooks(wc: WebContents): void {
    wc.on('before-input-event', (event, input) => {
      if (input.key === 'Tab' && (input.control || input.alt)) {
        // Swallow every event type of the chord: Blink moves focus on the
        // '\t' char (keypress) event, not the keyDown, so preventing only
        // keyDown lets Ctrl/Option+Tab walk focus through the chrome UI.
        event.preventDefault()
        if (input.type === 'keyDown') {
          tabs.cycleStep(input.control ? 'mru' : 'order', input.shift ? 'back' : 'forward')
        }
      } else if (input.key === 'Control' || input.key === 'Alt') {
        // macOS never delivers the modifier keyUp once the Tab chord is
        // consumed (verified via before-input-event capture), so a cycle is
        // committed by the NEXT modifier keyDown instead of its own release.
        // The keyUp case stays for platforms/paths where it does arrive;
        // commit is idempotent. Held modifiers don't autorepeat, so a
        // hold-and-walk never sees a second keyDown.
        tabs.cycleCommit()
      }
      if (process.env['CYCLE_DEBUG']) {
        appendFileSync(
          process.env['CYCLE_DEBUG'],
          `wc=${wc.id} ${input.type} key=${input.key} ctrl=${input.control} alt=${input.alt} -> active=${tabs.activeId}\n`,
        )
      }
    })
  }

  let sessionRestored = false
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 700,
    minHeight: 400,
    title: 'Synapse Browser',
    webPreferences: { preload: join(__dirname, '../preload/index.js') },
  })

  const tabs = new TabManager(win, {
    getBookmark: (id) => bookmarks.get(id),
    onBookmarkFavicon: (id, favicon) => {
      bookmarks.setFavicon(id, favicon)
      win.webContents.send('ui:bookmarks-changed')
    },
    onNavigated: (url, title) => history.add(url, title, Date.now()),
    onPageFavicon: (url, favicon) => favicons.set(url, favicon),
    onSnapshot: (snap) => {
      win.webContents.send('tabs:updated', snap)
      // the renderer's did-finish-load can fire a snapshot while startup is
      // still awaiting extensions.init(); persisting that empty state would
      // wipe the stores before restorePins/restoreTabs read them
      if (!sessionRestored) return
      tabsStore.save(
        snap.order.map((id) => {
          const t = snap.tabs[id]!
          return { url: t.url, profile: t.profile }
        }),
        snap.activeId ? snap.order.indexOf(snap.activeId) : -1,
      )
      pinsStore.save(
        snap.pinned.map((id) => ({
          url: snap.tabs[id]!.anchorUrl ?? snap.tabs[id]!.url,
          title: snap.tabs[id]!.title,
          favicon: snap.tabs[id]!.favicon,
          profile: snap.tabs[id]!.profile,
        })),
      )
    },
    // `extensions` is declared below; safe because tabs are only created
    // after it exists (restoreTabs runs at the end of startup)
    // Work tabs are deliberately invisible to ElectronChromeExtensions —
    // registering them would expose Work-container URLs to default-session
    // extensions through chrome.tabs
    onTabCreated: (wc, profile) => {
      attachCycleHooks(wc)
      // `bookmarksChanged` is declared below; safe for the same reason as
      // `extensions` — no tab exists until startup wiring completes
      attachPageContextMenu(wc, win, {
        openLinkInNewTab: (url) => tabs.createTab(url, false, profile, tabs.idFor(wc)),
        bookmarkLink: (url, title) => {
          bookmarks.add(url, title, Date.now(), profile)
          bookmarksChanged()
        },
      })
      if (profile === 'default') extensions.addTab(wc)
    },
    onTabActivated: (wc, profile) => {
      if (profile === 'default') extensions.selectTab(wc)
    },
    onSettingsClosed: () => win.webContents.send('ui:settings', false),
    onFindResult: (r) => win.webContents.send('ui:find-result', r),
  })
  const extensions = new ExtensionManager(win, tabs)
  tabs.setSidebarWidth(uiStore.sidebarWidth())
  const sidebarResize = new SidebarResizeController(
    {
      win,
      getPageWebContents: () => (tabs.activeId ? tabs.webContentsFor(tabs.activeId) : null),
      onWidth: (px) => {
        tabs.setSidebarWidth(px)
        win.webContents.send('ui:sidebar-width', px)
      },
      onCommit: (px) => uiStore.setSidebarWidth(px),
    },
    uiStore.sidebarWidth(),
  )
  tabs.setAiSidebarWidth(uiStore.aiSidebarWidth())
  tabs.setAiSidebarVisible(uiStore.aiSidebarVisible())
  const aiSidebarResize = new SidebarResizeController(
    {
      win,
      side: 'right',
      clamp: clampAiSidebarWidth,
      getPageWebContents: () => (tabs.activeId ? tabs.webContentsFor(tabs.activeId) : null),
      onWidth: (px) => {
        tabs.setAiSidebarWidth(px)
        win.webContents.send('ui:ai-width', px)
      },
      onCommit: (px) => uiStore.setAiSidebarWidth(px),
    },
    uiStore.aiSidebarWidth(),
  )
  const ai = new AiChatController({
    getSettings: () => ({ apiKey: settingsStore.aiApiKey(), model: settingsStore.aiModel() }),
    getActivePage: () => (tabs.activeId ? tabs.webContentsFor(tabs.activeId) : null),
    send: (channel, payload) => win.webContents.send(channel, payload),
  })
  const updater = new Updater(win)
  // silent launch check; dev builds check only via the menu
  if (app.isPackaged) setTimeout(() => void updater.check(false), 10_000)
  const toggleSidebar = (): void => {
    const visible = !uiStore.sidebarVisible()
    uiStore.setSidebarVisible(visible)
    tabs.setSidebarVisible(visible)
    win.webContents.send('ui:sidebar-visible', visible)
  }
  const toggleAiSidebar = (): void => {
    const visible = !uiStore.aiSidebarVisible()
    uiStore.setAiSidebarVisible(visible)
    tabs.setAiSidebarVisible(visible)
    win.webContents.send('ui:ai-visible', visible)
  }
  tabs.setSidebarVisible(uiStore.sidebarVisible())
  attachCycleHooks(win.webContents)

  openUrlInExistingWindow = (url) => {
    tabs.createTab(url)
    if (win.isMinimized()) win.restore()
    win.focus()
  }
  for (const url of pendingUrls.splice(0)) openUrlInExistingWindow(url)
  // losing window focus mid-cycle means the modifier keyUp will never arrive
  win.on('blur', () => tabs.cycleCommit())

  const downloads = new DownloadManager((list) => win.webContents.send('downloads:updated', list))
  downloads.attach(session.defaultSession)
  // the Work container: isolated cookies/storage/cache, persisted across runs.
  // No extensions are loaded into it and no webRequest handlers are registered
  // (repo rule). Created eagerly so downloads work before any Work tab exists.
  const workSession = session.fromPartition(WORK_PARTITION)
  downloads.attach(workSession)
  // mic/camera requests prompt per origin (persisted); both containers
  attachPermissionPrompts(session.defaultSession, win, permissionsStore)
  attachPermissionPrompts(workSession, win, permissionsStore)
  ipcMain.on('downloads:reveal', (_e, id: string) => downloads.reveal(id))

  ipcMain.on('tabs:create', (_e, url?: string) => {
    tabs.createTab(typeof url === 'string' ? url : undefined)
  })
  ipcMain.on('tabs:close', (_e, id: string) => tabs.closeTab(id))
  ipcMain.on('tabs:activate', (_e, id: string) => tabs.activateTab(id))
  ipcMain.on('tabs:navigate', (_e, id: string, input: string) => tabs.navigate(id, String(input)))
  ipcMain.on('tabs:back', (_e, id: string) => tabs.back(id))
  ipcMain.on('tabs:forward', (_e, id: string) => tabs.forward(id))
  ipcMain.on('tabs:reload', (_e, id: string) => tabs.reload(id))
  ipcMain.on('tabs:stop', (_e, id: string) => tabs.stop(id))
  ipcMain.on('tabs:reorder', (_e, id: string, toIndex: number) => {
    if (typeof id === 'string') tabs.reorderTab(id, Number(toIndex))
  })

  ipcMain.on('tabs:context-menu', (_e, id: string) => {
    if (typeof id !== 'string') return
    const pinned = tabs.isPinned(id)
    const profile = tabs.profileOf(id)
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: pinned ? 'Unpin Tab' : 'Pin Tab',
        click: () => tabs.togglePin(id),
      },
    ]
    if (pinned && tabs.isAwake(id)) {
      template.push({ label: 'Restore Pinned URL', click: () => tabs.restoreAnchor(id) })
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
            click: () => tabs.setProfile(id, 'default'),
          },
          {
            label: 'Work',
            type: 'radio',
            checked: profile === 'work',
            click: () => tabs.setProfile(id, 'work'),
          },
        ],
      },
      { type: 'separator' },
      // closing a pin puts it to sleep; the slot stays in the row
      { label: pinned ? 'Close' : 'Close Tab', click: () => tabs.closeTab(id) },
    )
    Menu.buildFromTemplate(template).popup({ window: win })
  })

  // suggestions blend shared history with the active tab's own profile's
  // bookmarks — a Work bookmark suggested to a default tab would load the
  // Work URL in the default session
  ipcMain.handle('history:search', (_e, q: string) => {
    const profile = tabs.activeId ? tabs.profileOf(tabs.activeId) : 'default'
    const marks = bookmarks.ordered().filter((b) => (b.profile ?? 'default') === profile)
    return searchSuggestions(history.entries(), marks, String(q), Date.now()).map((s) =>
      s.favicon ? s : { ...s, favicon: favicons.get(s.url) },
    )
  })
  ipcMain.handle('history:list', () => history.list())

  const bookmarksChanged = (): void => {
    tabs.syncBookmarks(bookmarks.ordered())
    win.webContents.send('ui:bookmarks-changed')
  }

  // ⌘D / ☆: convert the active tab into a bookmark, or a bookmark tab back
  const toggleBookmark = (): void => {
    const tid = tabs.activeId
    if (!tid) return
    const bid = tabs.bookmarkIdOf(tid)
    if (bid) {
      bookmarks.remove(bid)
      tabs.unbookmarkTab(bid)
    } else {
      if (tabs.isPinned(tid)) return // pins aren't convertible to bookmarks
      const info = tabs.activeInfo()
      if (!info || !/^https?:\/\//.test(info.url)) return
      const bm = bookmarks.add(info.url, info.title, Date.now(), tabs.profileOf(tid))
      tabs.bookmarkTab(tid, bm.id)
    }
    bookmarksChanged()
  }

  const exportBookmarks = async (): Promise<void> => {
    const date = new Date().toISOString().slice(0, 10)
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: `synapse-bookmarks-${date}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (canceled || !filePath) return
    writeFileSync(filePath, JSON.stringify({ v: 1, ...bookmarks.list() }, null, 2))
  }

  const importBookmarks = async (): Promise<void> => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (canceled || !filePaths[0]) return
    let text: string
    try {
      text = readFileSync(filePaths[0], 'utf8')
    } catch {
      void dialog.showMessageBox(win, { type: 'error', message: 'Could not read that file.' })
      return
    }
    const incoming = parseBookmarksExport(text)
    if (!incoming) {
      void dialog.showMessageBox(win, {
        type: 'error',
        message: 'Not a Synapse bookmarks export file.',
      })
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
    void dialog.showMessageBox(win, {
      type: 'info',
      message: `Imported ${n} bookmark${n === 1 ? '' : 's'}${
        plan.skipped ? ` (${plan.skipped} skipped as duplicates)` : ''
      }.`,
    })
  }
  ipcMain.handle('bookmarks:toggle-active', () => toggleBookmark())
  ipcMain.handle('bookmarks:list', () => bookmarks.list())

  // drag a sidebar tab into the bookmarks panel or a folder
  ipcMain.on(
    'bookmarks:create-from-tab',
    (_e, tabId: string, folderId: string | null) => {
      if (typeof tabId !== 'string') return
      if (folderId !== null && typeof folderId !== 'string') return
      if (tabs.isPinned(tabId) || tabs.bookmarkIdOf(tabId)) return
      const info = tabs.infoFor(tabId)
      if (!info || !/^https?:\/\//.test(info.url)) return
      const bm = bookmarks.add(info.url, info.title, Date.now(), tabs.profileOf(tabId))
      tabs.bookmarkTab(tabId, bm.id)
      if (folderId) bookmarks.moveToFolder(bm.id, folderId)
      bookmarksChanged()
    },
  )

  ipcMain.on('bookmarks:open', (_e, id: string) => {
    if (typeof id === 'string') tabs.openBookmark(id)
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
      const { response } = await dialog.showMessageBox(win, {
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

  ipcMain.on('bookmarks:context-menu', (_e, kind: string, id: string) => {
    if (typeof id !== 'string') return
    if (kind === 'folder') {
      const folder = bookmarks.list().folders.find((f) => f.id === id)
      if (!folder) return
      const setFolderProfile = (profile: ProfileId) => () => {
        bookmarks.setFolderProfile(id, profile)
        // members inherit through the store; awake member tabs must move
        // partitions now, asleep slots re-read the store on wake — setProfile
        // handles both (an asleep slot just updates its profile map entry)
        for (const b of bookmarks.list().bookmarks) {
          if (b.folderId !== id) continue
          const tid = tabs.bookmarkTabIdOf(b.id)
          if (tid) tabs.setProfile(tid, b.profile ?? 'default')
        }
        bookmarksChanged()
      }
      Menu.buildFromTemplate([
        { label: 'Rename', click: () => win.webContents.send('ui:edit-folder', id) },
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
      ]).popup({ window: win })
    } else if (kind === 'bookmark') {
      const { folders, bookmarks: all } = bookmarks.list()
      const bm = all.find((b) => b.id === id)
      if (!bm) return
      const tid = tabs.bookmarkTabIdOf(id)
      const awake = tid !== null && tabs.isAwake(tid)
      const currentUrl = awake ? tabs.webContentsFor(tid!)?.getURL() : undefined
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
        if (awake) tabs.setProfile(tid!, bookmarks.get(id)?.profile ?? 'default')
        bookmarksChanged()
      }
      const template: Electron.MenuItemConstructorOptions[] = [
        { label: 'Rename', click: () => win.webContents.send('ui:edit-bookmark', id) },
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
        template.push({ label: 'Restore Bookmarked URL', click: () => tabs.restoreAnchor(tid) })
      }
      if (awake) {
        template.push({ label: 'Put to Sleep', click: () => tabs.closeTab(tid!) })
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
      Menu.buildFromTemplate(template).popup({ window: win })
    }
  })

  const rebuildMenu = (): void =>
    buildMenu(win, tabs, extensions, shortcutsStore.resolved(), {
      toggleBookmark,
      toggleSidebar,
      toggleAiSidebar,
      toggleSettings: () => win.webContents.send('ui:settings', tabs.toggleSettings()),
      exportBookmarks: () => void exportBookmarks(),
      importBookmarks: () => void importBookmarks(),
      checkForUpdates: () => void updater.check(true),
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
  // Cmd+W closes the tab) instead of being recorded
  ipcMain.on('shortcuts:recording', (_e, active: boolean) => {
    win.webContents.setIgnoreMenuShortcuts(active === true)
  })

  ipcMain.on('ui:set-overlay-height', (_e, px: number) => tabs.setOverlayHeight(Number(px) || 0))
  ipcMain.on('ui:sidebar-drag-start', () => sidebarResize.start())
  ipcMain.on('ui:sidebar-drag-end', () => sidebarResize.end())
  ipcMain.on('ui:ai-drag-start', () => aiSidebarResize.start())
  ipcMain.on('ui:ai-drag-end', () => aiSidebarResize.end())

  ipcMain.on('ui:toggle-ai', () => toggleAiSidebar())

  // the AI sidebar's "Open Settings" shortcut must open, never close
  ipcMain.on('ui:open-settings', () => {
    if (!tabs.isSettingsOpen()) win.webContents.send('ui:settings', tabs.toggleSettings())
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

  ipcMain.on('find:start', (_e, text: string) => {
    if (typeof text === 'string') tabs.findStart(text)
  })
  ipcMain.on('find:step', (_e, dir: number) => tabs.findStep(dir === -1 ? -1 : 1))
  ipcMain.on('find:stop', () => tabs.findStop())

  win.webContents.on('did-finish-load', () => {
    tabs.refresh()
    win.webContents.setIgnoreMenuShortcuts(false)
    win.webContents.send('ui:sidebar-width', sidebarResize.current)
    win.webContents.send('ui:sidebar-visible', uiStore.sidebarVisible())
    win.webContents.send('ui:ai-width', aiSidebarResize.current)
    win.webContents.send('ui:ai-visible', uiStore.aiSidebarVisible())
    win.webContents.send('ui:settings', tabs.isSettingsOpen())
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  try {
    await extensions.init()
  } catch (err) {
    console.error('extensions: startup failed, continuing without extensions', err)
  }
  tabs.restorePins(pinsStore.load())
  tabs.syncBookmarks(bookmarks.ordered())
  const saved = tabsStore.load()
  tabs.restoreTabs(saved.tabs, saved.active)
  sessionRestored = true
  tabs.refresh() // persist the restored state now that saves are unblocked

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
