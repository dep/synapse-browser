import { BrowserWindow, WebContents, WebContentsView } from 'electron'
import { classifyInput, isHttpUrl } from '../shared/url-classifier'
import { CANVAS_GAP, CANVAS_RADIUS, computeCanvasBounds } from '../shared/canvas-layout'
import {
  computePaneRects,
  hasLeaf,
  leafIds,
  removeLeaf,
  replaceLeaf,
  splitLeaf,
} from '../shared/split-layout'
import type { PaneRect, SplitDir, SplitNode } from '../shared/split-layout'
import { PaneOverlays } from './pane-overlay'
import { isBlankUrl } from '../shared/newtab'
import { routeWindowOpen } from '../shared/popup-router'
import type { Bookmark, PinSlot, ProfileId, TabInfo, TabsSnapshot, WindowRole } from '../shared/ipc'
import { ClosedTabsStack } from './closed-tabs'
import { nextTabId } from './tab-ids'
import { CycleList, Direction, TabModel } from './tab-model'
import { errorPageDataUrl } from './error-page'
import { SIDEBAR_WIDTH_DEFAULT, clampSidebarWidth } from '../shared/sidebar-width'
import { AI_SIDEBAR_WIDTH_DEFAULT, clampAiSidebarWidth } from '../shared/ai'

export const TOPBAR_HEIGHT = 52
export const WORK_PARTITION = 'persist:profile-work'

// When a page destroys its own view (window.close() on a script-opened tab)
// Electron nulls the view's `webContents` getter; an already-torn-down view
// exposes a destroyed one. Either way the view can no longer be used.
function isDeadView(view: WebContentsView): boolean {
  const wc = view.webContents as WebContents | undefined
  return !wc || wc.isDestroyed()
}

export interface TabManagerOptions {
  role?: WindowRole // default 'primary'
  getBookmark(id: string): Bookmark | undefined
  onBookmarkFavicon(id: string, favicon: string | null): void
  onPageFavicon(url: string, favicon: string | null): void
  onNavigated(url: string, title: string): void
  onSnapshot(snap: TabsSnapshot): void
  onTabCreated?(wc: WebContents, profile: ProfileId): void
  onTabActivated?(wc: WebContents, profile: ProfileId): void
  onSettingsClosed?(): void
  onFindResult?(result: { matches: number; active: number }): void
  // called instead of auto-creating a fresh tab when the last one goes away;
  // secondary windows close themselves here
  onEmpty?(): void
  // a tab is leaving this window (tear-out): the host must drop its own
  // per-window wiring (cycle hooks, context menu, extension registration)
  onTabDetached?(wc: WebContents, profile: ProfileId): void
}

// a live tab in transit between windows: the view (and its WebContents —
// no reload, audio keeps playing) plus the state the destination re-adopts
export interface DetachedTab {
  id: string
  view: WebContentsView
  profile: ProfileId
  favicon: string | null
}

export class TabManager {
  private model = new TabModel()
  private views = new Map<string, WebContentsView>()
  private favicons = new Map<string, string | null>()
  private pins = new Map<string, PinSlot>()
  private profiles = new Map<string, ProfileId>()
  private bmTabId = new Map<string, string>() // bookmarkId → tabId
  private closed = new ClosedTabsStack()
  private attached: WebContentsView | null = null
  // split panes (issue #27): every visible view keyed by tab id — the focused
  // pane's view is also `attached` so single-view consumers (find, zoom, AI)
  // keep working untouched. splitRoot is non-null only while ≥2 panes tile.
  private attachedAll = new Map<string, WebContentsView>()
  private splitRoot: SplitNode | null = null
  private focusedLeaf: string | null = null
  private lastPaneRects: PaneRect[] = []
  private paneButtons: PaneOverlays
  private overlayHeight = 0
  private htmlFullscreenId: string | null = null
  private findText = ''
  private sidebarWidth = SIDEBAR_WIDTH_DEFAULT
  private sidebarVisible = true
  private aiSidebarWidth = AI_SIDEBAR_WIDTH_DEFAULT
  private aiSidebarVisible = false
  private settingsOpen = false
  private blankActivatedId: string | null = null
  // per-tab listener disposers, so a tab moving to another window (tear-out)
  // leaves none of this window's listeners behind on its WebContents
  private wired = new Map<string, Array<() => void>>()

  constructor(
    private win: BrowserWindow,
    private opts: TabManagerOptions,
  ) {
    this.paneButtons = new PaneOverlays(win)
    win.on('resize', () => this.layout())
  }

  get activeId(): string | null {
    return this.model.activeId
  }

  createTab(url?: string, activate = true, profile: ProfileId = 'default', opener?: string | null): string {
    // background tabs must not dismiss the settings screen
    if (activate && this.settingsOpen) {
      this.settingsOpen = false
      this.opts.onSettingsClosed?.()
    }
    const id = nextTabId()
    this.profiles.set(id, profile)
    const view = this.createView(id)
    this.model.add(id, activate, opener)
    if (url) view.webContents.loadURL(classifyInput(url))
    else if (activate) this.focusUrlBar()
    this.syncViews()
    return id
  }

  // featured popups (OAuth) stay real child windows: 'allow' preserves
  // window.opener/window.name and inherits the opener's webPreferences and
  // session, so Work-container isolation carries over for free. Links land
  // in the opener's container; cmd+click ('background-tab') must not steal
  // focus. Child windows get the same routing for anything they open.
  private wirePopupRouting(wc: WebContents, openerId: string): void {
    // a re-wire on adopt replaces the source window's handler outright
    wc.setWindowOpenHandler(({ url: popupUrl, disposition }) => {
      const route = routeWindowOpen(popupUrl, disposition)
      if (route === 'popup') {
        return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } }
      }
      if (route !== 'deny') {
        this.createTab(popupUrl, route === 'tab', this.profileOf(openerId), openerId)
      }
      return { action: 'deny' }
    })
    this.track(openerId, wc, 'did-create-window', (child: Electron.BrowserWindow) =>
      this.wirePopupRouting(child.webContents, openerId),
    )
  }

  // wc.on with a recorded disposer keyed by tab id (see `wired`)
  private track(id: string, wc: WebContents, event: string, fn: (...args: any[]) => void): void {
    const emitter = wc as unknown as NodeJS.EventEmitter
    emitter.on(event, fn)
    const list = this.wired.get(id) ?? []
    list.push(() => {
      if (!wc.isDestroyed()) emitter.removeListener(event, fn)
    })
    this.wired.set(id, list)
  }

  private unwire(id: string): void {
    for (const dispose of this.wired.get(id) ?? []) dispose()
    this.wired.delete(id)
  }

  private createView(id: string): WebContentsView {
    const profile = this.profileOf(id)
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        ...(profile === 'work' ? { partition: WORK_PARTITION } : {}),
      },
    })
    view.setBorderRadius(CANVAS_RADIUS)
    this.views.set(id, view)
    this.favicons.set(id, null)
    this.wireEvents(id, view.webContents)
    this.opts.onTabCreated?.(view.webContents, profile)
    this.wirePopupRouting(view.webContents, id)
    return view
  }

  closeTab(id: string): void {
    if (this.model.isSlot(id)) {
      this.sleepSlot(id)
      return
    }
    const view = this.views.get(id)
    if (!view) return
    this.closed.push({
      url: view.webContents.getURL(),
      profile: this.profileOf(id),
      index: this.model.order.indexOf(id),
    })
    const wasAttached = this.attached === view
    this.model.close(id)
    // ⌘W on a split pane: the pane collapses and focus stays inside the
    // tiling — the model's usual successor may be a hidden sidebar tab
    if (this.splitRoot && hasLeaf(this.splitRoot, id)) {
      this.splitRoot = removeLeaf(this.splitRoot, id)
      const remaining = this.splitRoot ? leafIds(this.splitRoot) : []
      if (remaining.length > 0 && this.model.activeId && !remaining.includes(this.model.activeId)) {
        this.model.activate(this.model.mru.find((t) => remaining.includes(t)) ?? remaining[0]!)
      }
    }
    this.destroyView(id, view, wasAttached)
    this.profiles.delete(id)
    if (!this.model.activeId) {
      this.handleEmpty()
      return
    }
    this.syncViews()
    // destroying the focused view leaves no first responder, and Blink then
    // parks keyboard focus on the chrome toolbar's first enabled button
    if (wasAttached) this.attached?.webContents.focus()
  }

  private handleEmpty(): void {
    if (this.opts.onEmpty) this.opts.onEmpty()
    else this.createTab()
  }

  // Tear a live tab out of this window without destroying its view. Only
  // plain order tabs move — pins and bookmark slots are window furniture.
  // The model's close() gives the source window its usual succession
  // (opener hand-back, right neighbor); the closed-tabs stack is untouched
  // because the page lives on elsewhere.
  detachTab(id: string): DetachedTab | null {
    const view = this.views.get(id)
    if (!view || this.model.isSlot(id) || isDeadView(view)) return null
    const wasAttached = this.attached === view
    if (wasAttached && this.findText) {
      view.webContents.stopFindInPage('clearSelection')
      this.findText = ''
    }
    if (this.attachedAll.get(id) === view) {
      this.win.contentView.removeChildView(view)
      this.attachedAll.delete(id)
    }
    if (wasAttached) this.attached = null
    this.unwire(id)
    const profile = this.profileOf(id)
    this.opts.onTabDetached?.(view.webContents, profile)
    const favicon = this.favicons.get(id) ?? null
    this.model.close(id)
    this.views.delete(id)
    this.favicons.delete(id)
    this.profiles.delete(id)
    if (!this.model.activeId) {
      this.handleEmpty()
      return { id, view, profile, favicon }
    }
    this.syncViews()
    if (wasAttached) this.attached?.webContents.focus()
    return { id, view, profile, favicon }
  }

  // the destination side of a tear-out: same id (process-unique), same live
  // WebContents; rewires events, popup routing, and host hooks to THIS window
  adoptTab(t: DetachedTab): void {
    this.profiles.set(t.id, t.profile)
    this.views.set(t.id, t.view)
    this.favicons.set(t.id, t.favicon)
    this.wireEvents(t.id, t.view.webContents)
    this.wirePopupRouting(t.view.webContents, t.id)
    this.opts.onTabCreated?.(t.view.webContents, t.profile)
    this.model.add(t.id, true)
    this.syncViews()
    this.attached?.webContents.focus()
  }

  // window teardown: close every view without model bookkeeping; ids are
  // cleared first so the resulting 'destroyed' events find nothing to reconcile
  dispose(): void {
    for (const id of [...this.wired.keys()]) this.unwire(id)
    const views = [...this.views.values()]
    this.views.clear()
    this.favicons.clear()
    this.profiles.clear()
    this.attached = null
    this.attachedAll.clear()
    this.splitRoot = null
    this.paneButtons.dispose()
    for (const view of views) {
      if (!isDeadView(view)) view.webContents.close()
    }
  }

  // Cmd+Shift+T: recreate the last closed tab at its old sidebar position.
  // Navigation history doesn't survive the close; the URL and container do.
  reopenClosedTab(): void {
    const t = this.closed.pop()
    if (!t) return
    const id = this.createTab(t.url, true, t.profile)
    this.model.reorder(id, t.index)
    this.refresh()
  }

  // the model picks the ids (slot-aware: from a pin/bookmark the whole tab
  // list counts as "below"/"other"); each id goes through closeTab for
  // proper view teardown, which never touches slots
  closeTabsRight(id: string): void {
    for (const t of this.model.tabsBelow(id)) this.closeTab(t)
  }

  closeTabsLeft(id: string): void {
    for (const t of this.model.tabsAbove(id)) this.closeTab(t)
  }

  closeOtherTabs(id: string): void {
    for (const t of this.model.otherTabs(id)) this.closeTab(t)
  }

  private destroyView(id: string, view: WebContentsView, wasAttached: boolean): void {
    this.unwire(id)
    this.views.delete(id)
    this.favicons.delete(id)
    if (this.attachedAll.get(id) === view) {
      this.win.contentView.removeChildView(view)
      this.attachedAll.delete(id)
    }
    if (wasAttached) {
      this.findText = ''
      this.attached = null
    }
    view.webContents.close()
  }

  private sleepSlot(id: string): void {
    const view = this.views.get(id)
    if (!view) return // already asleep
    const slot = this.pins.get(id)
    if (slot) {
      // keep the freshest title/icon for the sleeping button
      slot.title = view.webContents.getTitle() || slot.title
      slot.favicon = this.favicons.get(id) ?? slot.favicon
    }
    const wasAttached = this.attached === view
    this.model.sleep(id)
    this.destroyView(id, view, wasAttached)
    if (!this.model.activeId) {
      this.handleEmpty()
      return
    }
    this.syncViews()
    if (wasAttached) this.attached?.webContents.focus()
  }

  activateTab(id: string): void {
    if (this.settingsOpen) {
      this.settingsOpen = false
      this.opts.onSettingsClosed?.()
    }
    if (!this.views.has(id)) {
      if (this.model.isPinned(id)) this.wakePin(id)
      else if (this.model.isBookmarkSlot(id)) this.wakeBookmark(id)
      return
    }
    this.model.activate(id)
    this.syncViews()
    this.attached?.webContents.focus()
  }

  private wakePin(id: string): void {
    const slot = this.pins.get(id)
    if (!slot) return
    const view = this.createView(id)
    this.model.wake(id)
    view.webContents.loadURL(slot.url)
    this.syncViews()
    this.attached?.webContents.focus()
  }

  private wakeBookmark(tabId: string): void {
    const bid = this.bookmarkIdOf(tabId)
    const bm = bid ? this.opts.getBookmark(bid) : undefined
    if (!bm) return
    // profile can have changed while asleep; the store is authoritative
    this.profiles.set(tabId, bm.profile ?? 'default')
    const view = this.createView(tabId)
    this.model.wake(tabId)
    view.webContents.loadURL(bm.url)
    this.syncViews()
    this.attached?.webContents.focus()
  }

  // recreate a saved session: tabs in sidebar order, then the active one
  restoreTabs(tabs: { url: string; profile: ProfileId }[], active: number): void {
    if (tabs.length === 0) {
      this.createTab()
      return
    }
    const ids = tabs.map((t) => this.createTab(t.url || undefined, false, t.profile))
    this.activateTab(ids[Math.min(Math.max(active, 0), ids.length - 1)]!)
  }

  // register saved pins as asleep slots; called once at startup before restoreTabs
  restorePins(slots: PinSlot[]): void {
    for (const slot of slots) {
      const id = nextTabId()
      this.pins.set(id, { ...slot })
      this.profiles.set(id, slot.profile ?? 'default')
      this.model.addPin(id)
    }
  }

  togglePin(id: string | null): void {
    if (!id) return
    if (this.model.isPinned(id)) {
      if (!this.views.has(id)) this.wakePin(id) // a sleeping pin re-enters as a live tab
      this.pins.delete(id)
      this.model.unpin(id)
    } else {
      const wc = this.views.get(id)?.webContents
      if (!wc) return
      const url = wc.getURL()
      if (!isHttpUrl(url)) return // blank/error tabs have no url to pin
      if (!this.model.pin(id)) return // bookmark slots aren't convertible to pins
      this.pins.set(id, {
        url,
        title: wc.getTitle() || url,
        favicon: this.favicons.get(id) ?? null,
        profile: this.profileOf(id),
      })
    }
    this.syncViews()
  }

  profileOf(id: string): ProfileId {
    return this.profiles.get(id) ?? 'default'
  }

  bookmarkIdOf(tabId: string): string | null {
    for (const [bid, tid] of this.bmTabId) if (tid === tabId) return bid
    return null
  }

  bookmarkTabIdOf(bookmarkId: string): string | null {
    return this.bmTabId.get(bookmarkId) ?? null
  }

  // a WebContents' session is fixed at creation, so switching profile
  // recreates the view in the new partition; the tab keeps its id and
  // sidebar/MRU position, but navigation history resets
  setProfile(id: string, profile: ProfileId): void {
    if (this.profileOf(id) === profile) return
    this.profiles.set(id, profile)
    const slot = this.pins.get(id)
    if (slot) slot.profile = profile
    const view = this.views.get(id)
    if (!view) {
      this.refresh() // asleep pin: the new partition applies on wake
      return
    }
    const url = view.webContents.getURL()
    const wasAttached = this.attached === view
    this.destroyView(id, view, wasAttached)
    const next = this.createView(id)
    if (isHttpUrl(url)) next.webContents.loadURL(url)
    else if (id === this.model.activeId) this.focusUrlBar()
    this.syncViews()
    if (wasAttached) this.attached?.webContents.focus()
  }

  // reconcile bookmark slots with the store: new bookmarks get asleep slots,
  // deleted ones lose their slot (and live view), order mirrors the sidebar
  syncBookmarks(ordered: Bookmark[]): void {
    const live = new Set(ordered.map((b) => b.id))
    let destroyedAttached = false
    for (const [bid, tid] of [...this.bmTabId]) {
      if (live.has(bid)) continue
      const view = this.views.get(tid)
      if (view) {
        const wasAttached = this.attached === view
        destroyedAttached ||= wasAttached
        this.destroyView(tid, view, wasAttached)
      }
      this.model.removeBookmark(tid)
      this.profiles.delete(tid)
      this.bmTabId.delete(bid)
    }
    for (const b of ordered) {
      if (this.bmTabId.has(b.id)) continue
      const tid = nextTabId()
      this.bmTabId.set(b.id, tid)
      this.profiles.set(tid, b.profile ?? 'default')
      this.model.addBookmark(tid)
    }
    this.model.setBookmarkOrder(ordered.map((b) => this.bmTabId.get(b.id)!))
    if (destroyedAttached && !this.model.activeId) {
      this.handleEmpty()
      return
    }
    this.syncViews()
    if (destroyedAttached) this.attached?.webContents.focus()
  }

  openBookmark(bookmarkId: string): void {
    const tid = this.bmTabId.get(bookmarkId)
    if (tid) this.activateTab(tid)
  }

  // ⌘D: a live tab becomes the bookmark's tab in place
  bookmarkTab(tabId: string, bookmarkId: string): boolean {
    if (!this.model.bookmark(tabId)) return false // pins aren't convertible to bookmarks
    this.bmTabId.set(bookmarkId, tabId)
    return true
  }

  // ⌘D again: the page survives as a normal tab; an asleep slot just vanishes
  unbookmarkTab(bookmarkId: string): void {
    const tid = this.bmTabId.get(bookmarkId)
    if (!tid) return
    this.bmTabId.delete(bookmarkId)
    if (this.views.has(tid)) this.model.unbookmark(tid)
    else {
      this.model.removeBookmark(tid)
      this.profiles.delete(tid)
    }
  }

  restoreAnchor(id: string | null = this.model.activeId): void {
    if (!id) return
    const bid = this.bookmarkIdOf(id)
    const url = this.pins.get(id)?.url ?? (bid ? this.opts.getBookmark(bid)?.url : undefined)
    if (url) this.views.get(id)?.webContents.loadURL(url)
  }

  isPinned(id: string): boolean {
    return this.model.isPinned(id)
  }

  isAwake(id: string): boolean {
    return this.model.isAwake(id)
  }

  webContentsFor(id: string): WebContents | null {
    return this.views.get(id)?.webContents ?? null
  }

  idFor(wc: WebContents): string | null {
    for (const [id, view] of this.views) if (view.webContents === wc) return id
    return null
  }

  // index into pins-then-tabs; negative counts from the end (-1 = last)
  activateAt(index: number): void {
    const id = this.model.at(index)
    if (id) this.activateTab(id)
  }

  focusUrlBar(): void {
    // DOM focus() in the chrome renderer is not enough while a page view
    // holds native focus — the window must focus its own webContents first.
    this.win.webContents.focus()
    this.win.webContents.send('ui:focus-urlbar')
  }

  navigate(id: string, input: string): void {
    this.views.get(id)?.webContents.loadURL(classifyInput(input))
  }

  back(id: string): void {
    const wc = this.views.get(id)?.webContents
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  forward(id: string): void {
    const wc = this.views.get(id)?.webContents
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(id: string): void {
    this.views.get(id)?.webContents.reload()
  }

  // cmd-click back/forward/reload: open the entry the plain click would show
  // (offset from the active history index; 0 = current page) in a new
  // background tab in the same container. Blank/error entries have no URL
  // worth duplicating.
  openNavInNewTab(id: string, offset: -1 | 0 | 1): void {
    const nh = this.views.get(id)?.webContents.navigationHistory
    const url = nh?.getEntryAtIndex(nh.getActiveIndex() + offset)?.url
    if (url && isHttpUrl(url)) this.createTab(url, false, this.profileOf(id), id)
  }

  stop(id: string): void {
    this.views.get(id)?.webContents.stop()
  }

  reorderTab(id: string, toIndex: number): void {
    if (!Number.isFinite(toIndex)) return
    this.model.reorder(id, Math.round(toIndex))
    this.refresh()
  }

  cycleStep(list: CycleList, dir: Direction): void {
    if (this.settingsOpen) {
      this.settingsOpen = false
      this.opts.onSettingsClosed?.()
    }
    if (!this.model.cycleStep(list, dir)) return
    this.syncViews()
    // keep native focus on the newly attached view: the modifier keyUp that
    // commits the cycle must land on a webContents with the cycle hooks, and
    // detaching the previously focused view would otherwise leave none focused
    this.attached?.webContents.focus()
  }

  cycleCommit(): void {
    if (!this.model.isCycling()) return
    this.model.cycleCommit()
    // cycling swaps views without focusing them; return focus to the page
    this.attached?.webContents.focus()
    this.refresh()
  }

  activeInfo(): { url: string; title: string } | null {
    const id = this.model.activeId
    return id ? this.infoFor(id) : null
  }

  infoFor(id: string): { url: string; title: string } | null {
    const wc = this.views.get(id)?.webContents
    if (!wc) return null
    return { url: wc.getURL(), title: wc.getTitle() || wc.getURL() }
  }

  setOverlayHeight(px: number): void {
    this.overlayHeight = Math.max(0, Math.round(px))
    this.layout()
  }

  setSidebarWidth(px: number): void {
    this.sidebarWidth = clampSidebarWidth(px)
    this.layout()
  }

  setSidebarVisible(visible: boolean): void {
    this.sidebarVisible = visible
    this.layout()
  }

  setAiSidebarWidth(px: number): void {
    this.aiSidebarWidth = clampAiSidebarWidth(px)
    this.layout()
  }

  setAiSidebarVisible(visible: boolean): void {
    this.aiSidebarVisible = visible
    this.layout()
  }

  // while settings is open no page view is attached, so the chrome renderer
  // (which draws the settings UI in the page cell) is fully visible
  toggleSettings(): boolean {
    this.settingsOpen = !this.settingsOpen
    this.syncViews()
    return this.settingsOpen
  }

  isSettingsOpen(): boolean {
    return this.settingsOpen
  }

  // zoom the active page; Chromium's practical zoom-level range is about -7..9
  zoomActive(delta: 1 | -1 | 0): void {
    const wc = this.attached?.webContents
    if (!wc) return
    wc.setZoomLevel(delta === 0 ? 0 : Math.max(-7, Math.min(9, wc.getZoomLevel() + delta)))
  }

  // find sessions live on the attached (active) view; switching tabs ends them
  findStart(text: string): void {
    const wc = this.attached?.webContents
    if (!wc) return
    if (!text) {
      this.findStop()
      return
    }
    this.findText = text
    wc.findInPage(text)
  }

  findStep(dir: 1 | -1): void {
    const wc = this.attached?.webContents
    if (!wc || !this.findText) return
    wc.findInPage(this.findText, { findNext: true, forward: dir === 1 })
  }

  findStop(): void {
    this.findText = ''
    this.attached?.webContents.stopFindInPage('clearSelection')
  }

  // immediate prev/next in full sidebar order (awake pins, awake bookmark
  // slots, then tabs) with wraparound — unlike Ctrl+Tab MRU cycling there is
  // no preview/commit phase
  activateSibling(dir: 1 | -1): void {
    const next = this.model.sibling(dir)
    if (next) this.activateTab(next)
  }

  // ── split panes (issue #27) ──────────────────────────────────────────

  // Drop leaves whose tabs died or fell asleep, swap an outside activation
  // into the focused pane (the tiling stays put when the user clicks another
  // sidebar tab or Ctrl+Tabs away), and dissolve a split that's down to one
  // pane. Runs at the top of every syncViews, so every mutation path heals.
  private reconcileSplit(): void {
    if (!this.splitRoot) return
    for (const id of leafIds(this.splitRoot)) {
      if (!this.views.has(id) || !this.model.isAwake(id)) {
        this.splitRoot = this.splitRoot && removeLeaf(this.splitRoot, id)
      }
    }
    const active = this.model.activeId
    if (this.splitRoot && active && this.views.has(active) && !hasLeaf(this.splitRoot, active)) {
      const target =
        this.focusedLeaf && hasLeaf(this.splitRoot, this.focusedLeaf)
          ? this.focusedLeaf
          : leafIds(this.splitRoot)[0]!
      this.splitRoot = replaceLeaf(this.splitRoot, target, active)
    }
    if (this.splitRoot && active && hasLeaf(this.splitRoot, active)) this.focusedLeaf = active
    if (this.splitRoot && leafIds(this.splitRoot).length < 2) this.splitRoot = null
  }

  // ⌘D / ⌘⇧D: carve a fresh blank pane out of the focused pane's cell. The
  // new tab is a normal sidebar tab that happens to be tiled; urlbar focus
  // for typing its URL falls out of the existing blank-tab flow.
  splitActive(dir: SplitDir): void {
    const anchor = this.model.activeId
    if (!anchor || !this.views.has(anchor)) return
    if (this.settingsOpen) {
      this.settingsOpen = false
      this.opts.onSettingsClosed?.()
    }
    const id = nextTabId()
    this.profiles.set(id, this.profileOf(anchor))
    this.createView(id)
    this.splitRoot = splitLeaf(this.splitRoot ?? { leaf: anchor }, anchor, id, dir)
    this.focusedLeaf = id
    this.model.add(id, true, anchor)
    this.syncViews()
  }

  // ⌘-click on a sidebar tab or pin: tile it next to the focused pane
  // (vertical split). An existing pane is just focused; sleeping slots wake
  // in the background first so the activation lands inside the split.
  openInSplit(id: string): void {
    const anchor = this.model.activeId
    if (!anchor || id === anchor) return
    if (this.splitRoot && hasLeaf(this.splitRoot, id)) {
      this.activateTab(id)
      return
    }
    if (!this.views.has(id)) {
      const slot = this.model.isPinned(id) ? this.pins.get(id) : undefined
      const bid = !slot && this.model.isBookmarkSlot(id) ? this.bookmarkIdOf(id) : null
      const bm = bid ? this.opts.getBookmark(bid) : undefined
      const url = slot?.url ?? bm?.url
      if (!url) return
      if (bm) this.profiles.set(id, bm.profile ?? 'default')
      const view = this.createView(id)
      this.model.wake(id, false)
      view.webContents.loadURL(url)
    }
    if (this.settingsOpen) {
      this.settingsOpen = false
      this.opts.onSettingsClosed?.()
    }
    this.splitRoot = splitLeaf(this.splitRoot ?? { leaf: anchor }, anchor, id, 'row')
    this.focusedLeaf = id
    this.model.activate(id)
    this.syncViews()
    this.attached?.webContents.focus()
  }

  // the pane's ✕: untile the pane — the tab itself survives in the sidebar
  // (⌘-clicked tabs existed before the split; closing them would be lossy)
  closePane(id: string): void {
    if (!this.splitRoot || !hasLeaf(this.splitRoot, id)) return
    const remaining = leafIds(this.splitRoot).filter((t) => t !== id)
    this.splitRoot = removeLeaf(this.splitRoot, id)
    if (this.model.activeId === id && remaining.length > 0) {
      this.model.activate(this.model.mru.find((t) => remaining.includes(t)) ?? remaining[0]!)
    }
    this.syncViews()
    this.attached?.webContents.focus()
  }

  // a pane ✕ button document sent pane:close; true if this window owns it
  closePaneFromOverlay(wc: WebContents): boolean {
    const id = this.paneButtons.paneIdFor(wc)
    if (!id) return false
    this.closePane(id)
    return true
  }

  refresh(): void {
    this.opts.onSnapshot(this.snapshot())
    // a reloaded chrome document needs current pane geometry, not just ids
    this.win.webContents.send('ui:pane-rects', this.lastPaneRects)
  }

  private snapshot(): TabsSnapshot {
    const tabs: Record<string, TabInfo> = {}
    for (const id of [...this.model.pinned, ...this.model.bookmarks, ...this.model.order]) {
      const slot = this.pins.get(id)
      const bid = this.bookmarkIdOf(id)
      const wc = this.views.get(id)?.webContents
      if (wc) {
        const url = wc.getURL()
        tabs[id] = {
          id,
          title: wc.getTitle() || slot?.title || 'New Tab',
          url,
          favicon: this.favicons.get(id) ?? slot?.favicon ?? null,
          isLoading: wc.isLoading(),
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward(),
          isBookmarked: bid !== null,
          isPinned: !!slot,
          isAsleep: false,
          anchorUrl: slot?.url ?? (bid ? (this.opts.getBookmark(bid)?.url ?? null) : null),
          profile: this.profileOf(id),
        }
      } else if (slot) {
        tabs[id] = {
          id,
          title: slot.title,
          url: slot.url,
          favicon: slot.favicon,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          isBookmarked: false,
          isPinned: true,
          isAsleep: true,
          anchorUrl: slot.url,
          profile: this.profileOf(id),
        }
      }
    }
    const bookmarkTabs: Record<string, string> = {}
    for (const [bid, tid] of this.bmTabId) if (this.views.has(tid)) bookmarkTabs[bid] = tid
    // A page can destroy its own view (window.close() on a script-opened tab)
    // between snapshots; `destroyed` reconciles the model, but that event is
    // async and a synchronous snapshot can land in the gap. Emit only ids that
    // produced a `tabs` entry so consumers never dereference a missing tab
    // (renderer render, tabsStore.save). The stale id is dropped here and
    // fully removed from the model when `destroyed` fires.
    const emit = (ids: string[]) => ids.filter((id) => tabs[id])
    const activeId =
      this.model.activeId && tabs[this.model.activeId] ? this.model.activeId : null
    return {
      tabs,
      order: emit(this.model.order),
      pinned: emit(this.model.pinned),
      bookmarkTabs,
      activeId,
      panes: this.splitRoot ? emit(leafIds(this.splitRoot)) : [],
      role: this.opts.role ?? 'primary',
    }
  }

  private syncViews(): void {
    // A page can destroy its own webContents (window.close() on a script-opened
    // tab) — the `destroyed` event reconciles our state, but it's async and a
    // synchronous re-entrant path (e.g. extensions.addTab → selectTab →
    // activateTab while creating the next tab) can run first. Reap any view
    // whose contents already died so `attached` never points at a dead view;
    // `destroyed` still fires later, finds the id already gone, and no-ops.
    for (const [id, view] of [...this.views]) {
      if (isDeadView(view)) this.dropDeadView(id)
    }
    this.reconcileSplit()
    // One desired set for every visible view: all split leaves, or just the
    // active tab. A blank active tab attaches no view, leaving the chrome
    // renderer's new-tab page visible in its cell (same mechanism as
    // settings). A loading tab counts as a page tab even while getURL() is
    // still '' — a fresh view's first navigation hasn't committed yet, and
    // waiting for the URL would leave the view detached (and steal focus to
    // the urlbar).
    const showable = (v: WebContentsView): boolean =>
      !isBlankUrl(v.webContents.getURL()) || v.webContents.isLoading()
    const desired = new Map<string, WebContentsView>()
    if (!this.settingsOpen) {
      const ids = this.splitRoot
        ? leafIds(this.splitRoot)
        : this.model.activeId
          ? [this.model.activeId]
          : []
      for (const id of ids) {
        const v = this.views.get(id)
        if (v && showable(v)) desired.set(id, v)
      }
    }
    const activeView =
      !this.settingsOpen && this.model.activeId
        ? (this.views.get(this.model.activeId) ?? null)
        : null
    const active = this.model.activeId ? (desired.get(this.model.activeId) ?? null) : null
    for (const [id, v] of [...this.attachedAll]) {
      if (desired.get(id) !== v) {
        this.win.contentView.removeChildView(v)
        this.attachedAll.delete(id)
      }
    }
    for (const [id, v] of desired) {
      if (!this.attachedAll.has(id)) {
        this.win.contentView.addChildView(v)
        this.attachedAll.set(id, v)
      }
    }
    if (this.attached !== active) {
      if (this.attached && this.findText) {
        if (!isDeadView(this.attached)) this.attached.webContents.stopFindInPage('clearSelection')
        this.findText = ''
      }
      this.attached = active
      if (active) this.opts.onTabActivated?.(active.webContents, this.profileOf(this.model.activeId!))
    }
    // Blank active tabs attach no view, so the attach block above never runs
    // for them: keep extensions' active-tab state and native keyboard focus
    // honest anyway (chords are captured on the focused webContents, and the
    // chrome webContents has the same cycle hooks as page tabs).
    if (activeView && !active && this.model.activeId !== this.blankActivatedId) {
      this.blankActivatedId = this.model.activeId
      this.opts.onTabActivated?.(activeView.webContents, this.profileOf(this.model.activeId!))
      this.focusUrlBar() // focuses the chrome webContents first, keeping chords alive
    } else if (active || !activeView) {
      this.blankActivatedId = null
    }
    this.layout()
    this.refresh()
  }

  private layout(): void {
    const [w, h] = this.win.getContentSize()
    const fsView = this.htmlFullscreenId ? this.attachedAll.get(this.htmlFullscreenId) : undefined
    if (fsView) {
      fsView.setBounds({ x: 0, y: 0, width: w, height: h })
      this.syncPaneChrome([]) // glow and ✕ buttons would float above the video
      return
    }
    const canvas = computeCanvasBounds(w, h, {
      topbar: TOPBAR_HEIGHT,
      overlay: this.overlayHeight,
      sidebar: this.sidebarVisible ? this.sidebarWidth : 0,
      ai: this.aiSidebarVisible ? this.aiSidebarWidth : 0,
    })
    if (this.splitRoot && !this.settingsOpen) {
      const rects = computePaneRects(this.splitRoot, canvas, CANVAS_GAP)
      // blank leaves have no attached view; their rect still ships to the
      // chrome renderer, which draws its new-tab page in that cell
      for (const { id, rect } of rects) this.attachedAll.get(id)?.setBounds(rect)
      this.syncPaneChrome(rects)
      return
    }
    this.attached?.setBounds(canvas)
    this.syncPaneChrome([])
  }

  // pane geometry consumers outside the views themselves: the ✕ button
  // overlays (native, positioned here) and the chrome renderer (active-pane
  // glow, new-tab cell), which only sees window coordinates over IPC
  private syncPaneChrome(rects: PaneRect[]): void {
    if (rects.length === 0 && this.lastPaneRects.length === 0) return
    this.lastPaneRects = rects
    this.paneButtons.sync(rects)
    this.win.webContents.send('ui:pane-rects', rects)
  }

  // every listener goes through track() so detachTab can unwire the lot —
  // a moved tab must not keep driving this window's manager
  private wireEvents(id: string, wc: WebContents): void {
    const refresh = () => this.refresh()
    // HTML fullscreen (video players) must escape the carved canvas: drop the
    // rounded mask and fill the window, then restore the inset on leave
    this.track(id, wc, 'enter-html-full-screen', () => {
      this.htmlFullscreenId = id
      const view = this.views.get(id)
      view?.setBorderRadius(0)
      // in a split the fullscreen view must draw above its sibling panes;
      // re-adding an existing child raises it
      if (view && this.attachedAll.get(id) === view) this.win.contentView.addChildView(view)
      this.layout()
    })
    this.track(id, wc, 'leave-html-full-screen', () => {
      if (this.htmlFullscreenId === id) this.htmlFullscreenId = null
      this.views.get(id)?.setBorderRadius(CANVAS_RADIUS)
      this.layout()
    })
    this.track(id, wc, 'page-title-updated', refresh)
    // clicking into a pane hands its webContents native focus; follow it so
    // the focused pane, topbar, and sidebar highlight stay in sync
    this.track(id, wc, 'focus', () => {
      if (this.splitRoot && this.model.activeId !== id && hasLeaf(this.splitRoot, id)) {
        this.model.activate(id)
        this.syncViews()
      }
    })
    // attach/detach must be re-evaluated at every loading transition and at
    // commit, not just load start: a fresh view reports a blank getURL()
    // until its first navigation commits, so any single check can race and
    // leave an active tab's view detached — a blank page (issue #24).
    // syncViews ends with refresh(), so these are supersets of refresh.
    this.track(id, wc, 'did-start-loading', () => this.syncViews())
    this.track(id, wc, 'did-stop-loading', () => this.syncViews())
    this.track(id, wc, 'did-navigate', () => {
      this.favicons.set(id, null)
      this.syncViews()
    })
    this.track(id, wc, 'page-favicon-updated', (_e: Electron.Event, favicons: string[]) => {
      this.favicons.set(id, favicons[0] ?? null)
      const bid = this.bookmarkIdOf(id)
      if (bid) this.opts.onBookmarkFavicon(bid, favicons[0] ?? null)
      this.opts.onPageFavicon(wc.getURL(), favicons[0] ?? null)
      this.refresh()
    })
    this.track(id, wc, 'did-finish-load', () => {
      this.opts.onNavigated(wc.getURL(), wc.getTitle() || wc.getURL())
      this.refresh()
    })
    this.track(
      id,
      wc,
      'did-navigate-in-page',
      (_e: Electron.Event, url: string, isMainFrame: boolean) => {
        if (isMainFrame) this.opts.onNavigated(url, wc.getTitle() || url)
        this.refresh()
      },
    )
    this.track(
      id,
      wc,
      'did-fail-load',
      (_e: Electron.Event, code: number, desc: string, validatedUrl: string, isMainFrame: boolean) => {
        if (!isMainFrame || code === -3) return // -3 = user/redirect abort, not an error
        if (validatedUrl.startsWith('data:')) return // the error page itself failed; don't loop
        wc.loadURL(errorPageDataUrl(desc || `Error ${code}`, validatedUrl))
      },
    )
    this.track(id, wc, 'render-process-gone', (_e: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
      if (wc.getURL().startsWith('data:')) return // error page crashed; don't loop
      wc.loadURL(errorPageDataUrl(`Page crashed (${details.reason})`, wc.getURL()))
    })
    this.track(id, wc, 'found-in-page', (_e: Electron.Event, result: Electron.Result) => {
      // only the attached view's session is live; ignore stragglers
      if (this.attached?.webContents === wc) {
        this.opts.onFindResult?.({ matches: result.matches, active: result.activeMatchOrdinal })
      }
    })
    // A page can destroy its own view without going through us — window.close()
    // on a script-opened tab (OAuth popups routed to tabs), or a renderer kill.
    // Our own teardown deletes the id from `views` *before* webContents.close(),
    // so if the id is still mapped to this view here, the destroy came from
    // outside and the model still lists a tab with no live view. Reconcile it,
    // else the next snapshot dereferences an undefined tab or `attached` points
    // at a dead view — either crashes the main process.
    this.track(id, wc, 'destroyed', () => {
      if (this.views.get(id)?.webContents !== wc) return
      this.dropDeadView(id)
      if (!this.model.activeId) {
        this.handleEmpty()
        return
      }
      this.syncViews()
      this.attached?.webContents.focus()
    })
  }

  // Remove an externally-destroyed view (page window.close(), renderer gone)
  // from our state as if the user closed it: slots sleep, plain tabs close.
  // Pure bookkeeping — no syncViews/focus, so it is safe to call mid-syncViews.
  private dropDeadView(id: string): void {
    this.unwire(id)
    this.views.delete(id)
    this.favicons.delete(id)
    const dead = this.attachedAll.get(id)
    if (dead) {
      this.win.contentView.removeChildView(dead)
      this.attachedAll.delete(id)
    }
    if (this.attached && isDeadView(this.attached)) {
      this.attached = null
      this.findText = ''
    }
    if (this.model.isSlot(id)) {
      this.model.sleep(id)
    } else {
      this.model.close(id)
      this.profiles.delete(id)
    }
  }
}
