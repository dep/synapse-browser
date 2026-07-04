import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { BookmarksStore } from './bookmarks'
import { HistoryStore } from './history'
import { TabManager } from './tab-manager'

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  const history = new HistoryStore(userData)
  const bookmarks = new BookmarksStore(userData)

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
    onSnapshot: (snap) => win.webContents.send('tabs:updated', snap),
  })

  ipcMain.on('tabs:create', (_e, url?: string) => {
    tabs.createTab(typeof url === 'string' ? url : undefined)
  })
  ipcMain.on('tabs:close', (_e, id: string) => tabs.closeTab(id))
  ipcMain.on('tabs:activate', (_e, id: string) => tabs.activateTab(id))
  ipcMain.on('tabs:navigate', (_e, id: string, input: string) => tabs.navigate(id, input))
  ipcMain.on('tabs:back', (_e, id: string) => tabs.back(id))
  ipcMain.on('tabs:forward', (_e, id: string) => tabs.forward(id))
  ipcMain.on('tabs:reload', (_e, id: string) => tabs.reload(id))

  ipcMain.handle('history:search', (_e, q: string) => history.search(String(q)))
  ipcMain.handle('history:list', () => history.list())

  ipcMain.handle('bookmarks:toggle-active', () => {
    const info = tabs.activeInfo()
    if (!info || !/^https?:\/\//.test(info.url)) return
    bookmarks.toggle(info.url, info.title, Date.now())
    tabs.refresh()
  })
  ipcMain.handle('bookmarks:list', () => bookmarks.list())

  ipcMain.on('ui:set-overlay-height', (_e, px: number) => tabs.setOverlayHeight(Number(px) || 0))

  win.webContents.on('did-finish-load', () => tabs.refresh())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  tabs.createTab()

  app.on('before-quit', () => {
    history.flush()
    bookmarks.flush()
  })
})

app.on('window-all-closed', () => app.quit())
