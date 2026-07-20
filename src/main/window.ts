import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProfileId, WindowRole } from '../shared/ipc'
import type { BookmarksStore } from './bookmarks'
import type { ExtensionManager } from './extensions'
import type { FaviconStore } from './favicons'
import type { HistoryStore } from './history'
import type { PinsStore } from './pins-store'
import type { TabsStore } from './tabs-store'
import type { UiStore } from './ui-store'
import { SidebarResizeController } from './sidebar-resize'
import { SuggestionsOverlay } from './suggestions-overlay'
import { TabManager } from './tab-manager'
import type { DetachedTab } from './tab-manager'
import { attachPageContextMenu } from './page-context-menu-host'
import { clampAiSidebarWidth } from '../shared/ai'

// One browser window = one bundle: its own TabManager (and pure TabModel),
// suggestions overlay, resize controllers, and cycle-hook wiring. The primary
// bundle additionally persists tabs/pins and renders pins/bookmarks/AI; a
// secondary bundle is an ephemeral workspace (Cmd+N, tab tear-out).
export interface WindowBundle {
  win: BrowserWindow
  tabs: TabManager
  suggestions: SuggestionsOverlay
  sidebarResize: SidebarResizeController
  aiSidebarResize: SidebarResizeController
  role: WindowRole
  sidebarVisible: boolean
  aiVisible: boolean
  // per-webContents unwire hooks (cycle hooks, context menu) so a tab can
  // move to another window without dragging this window's listeners along
  addDisposer(wc: WebContents, d: () => void): void
  disposeFor(wc: WebContents): void
}

// app-global services a window needs; built once in index.ts
export interface WindowDeps {
  history: HistoryStore
  favicons: FaviconStore
  bookmarks: BookmarksStore
  tabsStore: TabsStore
  pinsStore: PinsStore
  uiStore: UiStore
  extensions: ExtensionManager
  bookmarksChanged(): void
  // persistence gate: snapshots during startup must not clobber the stores
  isSessionRestored(): boolean
}

const bundles = new Map<number, WindowBundle>() // win.id → bundle
const byWc = new Map<number, WindowBundle>() // chrome/overlay wc.id → bundle
let primaryB: WindowBundle | null = null

// resolve an IPC sender (chrome renderer or suggestions overlay) to its window
export function bundleFor(sender: WebContents): WindowBundle | null {
  return byWc.get(sender.id) ?? null
}

// resolve a page tab's webContents to the window that owns it
export function bundleOwningTab(wc: WebContents): WindowBundle | null {
  for (const b of bundles.values()) if (b.tabs.idFor(wc) !== null) return b
  return null
}

export function focusedBundle(): WindowBundle | null {
  const win = BrowserWindow.getFocusedWindow()
  return win ? (bundles.get(win.id) ?? null) : null
}

// the primary if alive, else any surviving window (the primary can be closed
// while secondaries live on)
export function primaryBundle(): WindowBundle | null {
  return primaryB ?? bundles.values().next().value ?? null
}

export function allBundles(): WindowBundle[] {
  return [...bundles.values()]
}

// Ctrl+Tab (MRU) / Option+Tab (sidebar order) chords, captured per-window via
// before-input-event — menu accelerators can't see the key-up that commits a
// hold-and-walk cycle. Returns a disposer for tabs that move windows.
function attachCycleHooks(wc: WebContents, tabs: TabManager): () => void {
  const handler = (event: Electron.Event, input: Electron.Input): void => {
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
  }
  wc.on('before-input-event', handler)
  return () => {
    if (!wc.isDestroyed()) wc.removeListener('before-input-event', handler)
  }
}

export function createWindow(
  role: WindowRole,
  deps: WindowDeps,
  opts?: { position?: { x: number; y: number }; adopt?: DetachedTab },
): WindowBundle {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 700,
    minHeight: 400,
    title: 'Synapse Browser',
    webPreferences: { preload: join(__dirname, '../preload/index.js') },
  })
  if (opts?.position) win.setPosition(Math.round(opts.position.x), Math.round(opts.position.y))

  const disposers = new Map<number, Array<() => void>>()
  const addDisposer = (wc: WebContents, d: () => void): void => {
    const list = disposers.get(wc.id) ?? []
    list.push(d)
    disposers.set(wc.id, list)
  }
  const disposeFor = (wc: WebContents): void => {
    for (const d of disposers.get(wc.id) ?? []) d()
    disposers.delete(wc.id)
  }

  const tabs: TabManager = new TabManager(win, {
    role,
    getBookmark: (id) => (role === 'primary' ? deps.bookmarks.get(id) : undefined),
    onBookmarkFavicon: (id, favicon) => {
      if (role !== 'primary') return
      deps.bookmarks.setFavicon(id, favicon)
      win.webContents.send('ui:bookmarks-changed')
    },
    onNavigated: (url, title) => deps.history.add(url, title, Date.now()),
    onPageFavicon: (url, favicon) => deps.favicons.set(url, favicon),
    onSnapshot: (snap) => {
      win.webContents.send('tabs:updated', snap)
      // only the primary window persists; secondaries are ephemeral. The
      // renderer's did-finish-load can fire a snapshot while startup is
      // still awaiting extensions.init(); persisting that empty state would
      // wipe the stores before restorePins/restoreTabs read them
      if (role !== 'primary' || !deps.isSessionRestored()) return
      deps.tabsStore.save(
        snap.order.map((id) => {
          const t = snap.tabs[id]!
          return {
            url: t.url,
            profile: t.profile,
            ...(t.customTitle ? { title: t.customTitle } : {}),
            ...(snap.tabGroups[id] ? { group: snap.tabGroups[id] } : {}),
          }
        }),
        snap.activeId ? snap.order.indexOf(snap.activeId) : -1,
        Object.values(snap.groups),
      )
      deps.pinsStore.save(
        snap.pinned.map((id) => ({
          url: snap.tabs[id]!.anchorUrl ?? snap.tabs[id]!.url,
          title: snap.tabs[id]!.title,
          favicon: snap.tabs[id]!.favicon,
          profile: snap.tabs[id]!.profile,
        })),
      )
    },
    // Work tabs are deliberately invisible to ElectronChromeExtensions —
    // registering them would expose Work-container URLs to default-session
    // extensions through chrome.tabs
    onTabCreated: (wc: WebContents, profile: ProfileId) => {
      addDisposer(wc, attachCycleHooks(wc, tabs))
      addDisposer(
        wc,
        attachPageContextMenu(wc, win, {
          openLinkInNewTab: (url) => tabs.createTab(url, false, profile, tabs.idFor(wc)),
          bookmarkLink: (url, title) => {
            deps.bookmarks.add(url, title, Date.now(), profile)
            deps.bookmarksChanged()
          },
        }),
      )
      if (profile === 'default') deps.extensions.addTab(wc, win)
    },
    onTabActivated: (wc, profile) => {
      if (profile === 'default') deps.extensions.selectTab(wc)
    },
    onSettingsClosed: () => win.webContents.send('ui:settings', false),
    onFindResult: (r) => win.webContents.send('ui:find-result', r),
    // a tab tearing out of this window: drop this window's cycle-hook and
    // context-menu listeners, and its extension registration — the
    // destination window re-registers all three on adopt
    onTabDetached: (wc, profile) => {
      disposeFor(wc)
      if (profile === 'default') deps.extensions.removeTab(wc)
    },
    // a secondary window with no tabs left closes itself; the primary
    // falls back to TabManager's fresh-tab default
    ...(role === 'secondary' ? { onEmpty: () => win.close() } : {}),
  })

  tabs.setSidebarWidth(deps.uiStore.sidebarWidth())
  const sidebarResize = new SidebarResizeController(
    {
      win,
      getPageWebContents: () => (tabs.activeId ? tabs.webContentsFor(tabs.activeId) : null),
      onWidth: (px) => {
        tabs.setSidebarWidth(px)
        win.webContents.send('ui:sidebar-width', px)
      },
      onCommit: (px) => deps.uiStore.setSidebarWidth(px),
    },
    deps.uiStore.sidebarWidth(),
  )
  tabs.setAiSidebarWidth(deps.uiStore.aiSidebarWidth())
  const aiVisible = role === 'primary' && deps.uiStore.aiSidebarVisible()
  tabs.setAiSidebarVisible(aiVisible)
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
      onCommit: (px) => deps.uiStore.setAiSidebarWidth(px),
    },
    deps.uiStore.aiSidebarWidth(),
  )
  const sidebarVisible = role === 'primary' ? deps.uiStore.sidebarVisible() : true
  tabs.setSidebarVisible(sidebarVisible)
  attachCycleHooks(win.webContents, tabs)
  // losing window focus mid-cycle means the modifier keyUp will never arrive
  win.on('blur', () => tabs.cycleCommit())

  const suggestions = new SuggestionsOverlay(win)

  const bundle: WindowBundle = {
    win,
    tabs,
    suggestions,
    sidebarResize,
    aiSidebarResize,
    role,
    sidebarVisible,
    aiVisible,
    addDisposer,
    disposeFor,
  }
  // captured now: the getters throw "Object has been destroyed" inside 'closed'
  const winId = win.id
  const chromeWcId = win.webContents.id
  const suggWcId = suggestions.webContents.id
  bundles.set(winId, bundle)
  byWc.set(chromeWcId, bundle)
  byWc.set(suggWcId, bundle)
  if (role === 'primary') primaryB = bundle

  win.on('closed', () => {
    bundles.delete(winId)
    byWc.delete(chromeWcId)
    byWc.delete(suggWcId)
    if (primaryB === bundle) primaryB = null
    tabs.dispose()
  })

  win.webContents.on('did-finish-load', () => {
    tabs.refresh()
    tabs.resendPaneRects()
    win.webContents.setIgnoreMenuShortcuts(false)
    win.webContents.send('ui:sidebar-width', sidebarResize.current)
    win.webContents.send('ui:sidebar-visible', bundle.sidebarVisible)
    win.webContents.send('ui:ai-width', aiSidebarResize.current)
    win.webContents.send('ui:ai-visible', bundle.aiVisible)
    win.webContents.send('ui:settings', tabs.isSettingsOpen())
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // the primary restores its session in index.ts after extensions init;
  // a fresh secondary starts with a single blank tab — or the live tab it
  // was just torn out around
  if (opts?.adopt) tabs.adoptTab(opts.adopt)
  else if (role === 'secondary') tabs.createTab()

  return bundle
}

// tear `tabId` out of `source` into its own secondary window at the drop
// point; the WebContents moves live (no reload)
export function detachTabToNewWindow(
  source: WindowBundle,
  tabId: string,
  screenX: number,
  screenY: number,
  deps: WindowDeps,
): void {
  const t = source.tabs.detachTab(tabId)
  if (!t) return
  const b = createWindow('secondary', deps, {
    position: { x: Math.max(0, Math.round(screenX) - 80), y: Math.max(0, Math.round(screenY) - 20) },
    adopt: t,
  })
  b.win.focus()
}
