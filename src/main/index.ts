import { app, BrowserWindow, ipcMain, Menu, session } from 'electron'
import type { WebContents } from 'electron'
import { appendFileSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { BookmarksStore } from './bookmarks'
import { DownloadManager } from './downloads'
import { HistoryStore } from './history'
import { PinsStore } from './pins-store'
import { TabManager } from './tab-manager'
import { TabsStore } from './tabs-store'
import { buildMenu } from './menu'

app.whenReady().then(() => {
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
        snap.order.map((id) => snap.tabs[id]!.url),
        snap.activeId ? snap.order.indexOf(snap.activeId) : -1,
      )
      pinsStore.save(
        snap.pinned.map((id) => ({
          url: snap.tabs[id]!.pinnedUrl ?? snap.tabs[id]!.url,
          title: snap.tabs[id]!.title,
          favicon: snap.tabs[id]!.favicon,
        })),
      )
    },
    onTabCreated: (wc) => attachCycleHooks(wc),
  })
  attachCycleHooks(win.webContents)
  // losing window focus mid-cycle means the modifier keyUp will never arrive
  win.on('blur', () => tabs.cycleCommit())

  const downloads = new DownloadManager((list) => win.webContents.send('downloads:updated', list))
  downloads.attach(session.defaultSession)
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

  ipcMain.on('tabs:context-menu', (_e, id: string) => {
    if (typeof id !== 'string') return
    const pinned = tabs.isPinned(id)
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: pinned ? 'Unpin Tab' : 'Pin Tab',
        click: () => tabs.togglePin(id),
      },
    ]
    if (pinned && tabs.isAwake(id)) {
      template.push({ label: 'Restore Pinned URL', click: () => tabs.restorePinnedUrl(id) })
    }
    template.push(
      { type: 'separator' },
      // closing a pin puts it to sleep; the slot stays in the row
      { label: pinned ? 'Close' : 'Close Tab', click: () => tabs.closeTab(id) },
    )
    Menu.buildFromTemplate(template).popup({ window: win })
  })

  ipcMain.handle('history:search', (_e, q: string) => history.search(String(q)))
  ipcMain.handle('history:list', () => history.list())

  const toggleBookmark = (): void => {
    const info = tabs.activeInfo()
    if (!info || !/^https?:\/\//.test(info.url)) return
    bookmarks.toggle(info.url, info.title, Date.now())
    tabs.refresh()
  }
  ipcMain.handle('bookmarks:toggle-active', () => toggleBookmark())
  ipcMain.handle('bookmarks:list', () => bookmarks.list())

  buildMenu(win, tabs, toggleBookmark)

  ipcMain.on('ui:set-overlay-height', (_e, px: number) => tabs.setOverlayHeight(Number(px) || 0))

  win.webContents.on('did-finish-load', () => tabs.refresh())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  tabs.restorePins(pinsStore.load())
  const saved = tabsStore.load()
  tabs.restoreTabs(saved.urls, saved.active)

  app.on('before-quit', () => {
    history.flush()
    bookmarks.flush()
    tabsStore.flush()
    pinsStore.flush()
  })
})

app.on('window-all-closed', () => app.quit())
