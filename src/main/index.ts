import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron'
import type { WebContents } from 'electron'
import { appendFileSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { BookmarksStore } from './bookmarks'
import { DownloadManager } from './downloads'
import { ExtensionManager } from './extensions'
import { HistoryStore } from './history'
import { PinsStore } from './pins-store'
import { TabManager, WORK_PARTITION } from './tab-manager'
import { TabsStore } from './tabs-store'
import { buildMenu } from './menu'

app.whenReady().then(async () => {
  // in dev the Dock shows the stock Electron icon; a packaged app gets icon.icns
  const dockIcon = join(app.getAppPath(), 'resources/icon.png')
  if (existsSync(dockIcon)) app.dock?.setIcon(dockIcon)

  const userData = app.getPath('userData')
  // productName renamed the userData dir; pull stores from the pre-rename one
  const legacyDir = join(app.getPath('appData'), 'synapse-browser')
  for (const f of ['history.json', 'bookmarks.json']) {
    const src = join(legacyDir, f)
    const dst = join(userData, f)
    if (src !== dst && existsSync(src) && !existsSync(dst)) copyFileSync(src, dst)
  }
  const history = new HistoryStore(userData)
  const bookmarks = new BookmarksStore(userData)
  const tabsStore = new TabsStore(userData)
  const pinsStore = new PinsStore(userData)

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

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 700,
    minHeight: 400,
    title: 'Synapse Browser',
    webPreferences: { preload: join(__dirname, '../preload/index.js') },
  })

  const tabs = new TabManager(win, {
    isBookmarked: (url) => bookmarks.isBookmarked(url),
    onNavigated: (url, title) => history.add(url, title, Date.now()),
    onSnapshot: (snap) => {
      win.webContents.send('tabs:updated', snap)
      tabsStore.save(
        snap.order.map((id) => {
          const t = snap.tabs[id]!
          return { url: t.url, profile: t.profile, ...(t.anchorUrl ? { anchor: t.anchorUrl } : {}) }
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
      if (profile === 'default') extensions.addTab(wc)
    },
    onTabActivated: (wc, profile) => {
      if (profile === 'default') extensions.selectTab(wc)
    },
  })
  const extensions = new ExtensionManager(win, tabs)
  attachCycleHooks(win.webContents)
  // losing window focus mid-cycle means the modifier keyUp will never arrive
  win.on('blur', () => tabs.cycleCommit())

  const downloads = new DownloadManager((list) => win.webContents.send('downloads:updated', list))
  downloads.attach(session.defaultSession)
  // the Work container: isolated cookies/storage/cache, persisted across runs.
  // No extensions are loaded into it and no webRequest handlers are registered
  // (repo rule). Created eagerly so downloads work before any Work tab exists.
  const workSession = session.fromPartition(WORK_PARTITION)
  downloads.attach(workSession)
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
    } else if (tabs.isAwake(id) && tabs.isAnchored(id)) {
      template.push({ label: 'Restore Bookmarked URL', click: () => tabs.restoreAnchor(id) })
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

  ipcMain.handle('history:search', (_e, q: string) => history.search(String(q)))
  ipcMain.handle('history:list', () => history.list())

  const bookmarksChanged = (): void => {
    // isBookmarked on tab snapshots (star state) may have changed
    tabs.refresh()
    win.webContents.send('ui:bookmarks-changed')
  }

  const toggleBookmark = (): void => {
    const info = tabs.activeInfo()
    if (!info || !/^https?:\/\//.test(info.url)) return
    bookmarks.toggle(info.url, info.title, Date.now())
    bookmarksChanged()
  }
  ipcMain.handle('bookmarks:toggle-active', () => toggleBookmark())
  ipcMain.handle('bookmarks:list', () => bookmarks.list())

  ipcMain.on('bookmarks:open', (_e, id: string) => {
    const bm = bookmarks.list().bookmarks.find((b) => b.id === id)
    if (bm) tabs.openBookmark(bm.url)
  })
  ipcMain.on('bookmarks:remove', (_e, id: string) => {
    if (typeof id !== 'string') return
    bookmarks.remove(id)
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
      Menu.buildFromTemplate([
        { label: 'Rename', click: () => win.webContents.send('ui:edit-folder', id) },
        { label: 'Delete Folder…', click: () => void removeFolderWithConfirm(id) },
      ]).popup({ window: win })
    } else if (kind === 'bookmark') {
      const { folders, bookmarks: all } = bookmarks.list()
      const bm = all.find((b) => b.id === id)
      if (!bm) return
      const moveTo = (folderId: string | null) => () => {
        bookmarks.moveToFolder(id, folderId)
        bookmarksChanged()
      }
      Menu.buildFromTemplate([
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
          label: 'Delete Bookmark',
          click: () => {
            bookmarks.remove(id)
            bookmarksChanged()
          },
        },
      ]).popup({ window: win })
    }
  })

  buildMenu(win, tabs, toggleBookmark, extensions)
  // the Tools → Extensions submenu lists installed extensions; rebuild it as they change
  session.defaultSession.on('extension-loaded', () => buildMenu(win, tabs, toggleBookmark, extensions))
  session.defaultSession.on('extension-unloaded', () => buildMenu(win, tabs, toggleBookmark, extensions))

  ipcMain.on('ui:set-overlay-height', (_e, px: number) => tabs.setOverlayHeight(Number(px) || 0))

  win.webContents.on('did-finish-load', () => tabs.refresh())

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
  const saved = tabsStore.load()
  tabs.restoreTabs(saved.tabs, saved.active)

  app.on('before-quit', () => {
    history.flush()
    bookmarks.flush()
    tabsStore.flush()
    pinsStore.flush()
  })
})

app.on('window-all-closed', () => app.quit())
