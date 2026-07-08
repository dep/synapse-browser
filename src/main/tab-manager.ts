import { BrowserWindow, WebContents, WebContentsView } from 'electron'
import { classifyInput } from '../shared/url-classifier'
import type { Bookmark, PinSlot, ProfileId, TabInfo, TabsSnapshot } from '../shared/ipc'
import { CycleList, Direction, TabModel } from './tab-model'
import { errorPageDataUrl } from './error-page'
import { SIDEBAR_WIDTH_DEFAULT, clampSidebarWidth } from '../shared/sidebar-width'

export const TOPBAR_HEIGHT = 52
export const WORK_PARTITION = 'persist:profile-work'

export interface TabManagerOptions {
  getBookmark(id: string): Bookmark | undefined
  onBookmarkFavicon(id: string, favicon: string | null): void
  onNavigated(url: string, title: string): void
  onSnapshot(snap: TabsSnapshot): void
  onTabCreated?(wc: WebContents, profile: ProfileId): void
  onTabActivated?(wc: WebContents, profile: ProfileId): void
  onSettingsClosed?(): void
}

export class TabManager {
  private model = new TabModel()
  private views = new Map<string, WebContentsView>()
  private favicons = new Map<string, string | null>()
  private pins = new Map<string, PinSlot>()
  private profiles = new Map<string, ProfileId>()
  private bmTabId = new Map<string, string>() // bookmarkId → tabId
  private attached: WebContentsView | null = null
  private overlayHeight = 0
  private sidebarWidth = SIDEBAR_WIDTH_DEFAULT
  private sidebarVisible = true
  private settingsOpen = false
  private counter = 0

  constructor(
    private win: BrowserWindow,
    private opts: TabManagerOptions,
  ) {
    win.on('resize', () => this.layout())
  }

  get activeId(): string | null {
    return this.model.activeId
  }

  createTab(url?: string, activate = true, profile: ProfileId = 'default'): string {
    if (this.settingsOpen) {
      this.settingsOpen = false
      this.opts.onSettingsClosed?.()
    }
    const id = `tab-${++this.counter}`
    this.profiles.set(id, profile)
    const view = this.createView(id)
    this.model.add(id, activate)
    if (url) view.webContents.loadURL(classifyInput(url))
    else if (activate) this.focusUrlBar()
    this.syncViews()
    return id
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
    this.views.set(id, view)
    this.favicons.set(id, null)
    this.wireEvents(id, view.webContents)
    this.opts.onTabCreated?.(view.webContents, profile)
    view.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
      // popups (OAuth windows etc.) must land in the opener's container
      if (/^https?:\/\//.test(popupUrl)) this.createTab(popupUrl, true, this.profileOf(id))
      return { action: 'deny' }
    })
    return view
  }

  closeTab(id: string): void {
    if (this.model.isPinned(id) || this.model.isBookmarkSlot(id)) {
      this.sleepSlot(id)
      return
    }
    const view = this.views.get(id)
    if (!view) return
    const wasAttached = this.attached === view
    this.model.close(id)
    this.destroyView(id, view, wasAttached)
    this.profiles.delete(id)
    if (!this.model.activeId) {
      this.createTab()
      return
    }
    this.syncViews()
    // destroying the focused view leaves no first responder, and Blink then
    // parks keyboard focus on the chrome toolbar's first enabled button
    if (wasAttached) this.attached?.webContents.focus()
  }

  // pins/bookmarks are separate slots (model.order excludes them), so these
  // never touch them; each closed id still goes through closeTab for proper
  // view teardown
  closeTabsRight(id: string): void {
    const i = this.model.order.indexOf(id)
    if (i === -1) return
    for (const t of this.model.order.slice(i + 1)) this.closeTab(t)
  }

  closeTabsLeft(id: string): void {
    const i = this.model.order.indexOf(id)
    if (i === -1) return
    for (const t of this.model.order.slice(0, i)) this.closeTab(t)
  }

  closeOtherTabs(id: string): void {
    if (!this.model.order.includes(id)) return
    for (const t of this.model.order.filter((t) => t !== id)) this.closeTab(t)
  }

  private destroyView(id: string, view: WebContentsView, wasAttached: boolean): void {
    this.views.delete(id)
    this.favicons.delete(id)
    if (wasAttached) {
      this.win.contentView.removeChildView(view)
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
      this.createTab()
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
      const id = `tab-${++this.counter}`
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
      if (!/^https?:\/\//.test(url)) return // blank/error tabs have no url to pin
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
    if (/^https?:\/\//.test(url)) next.webContents.loadURL(url)
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
      const tid = `tab-${++this.counter}`
      this.bmTabId.set(b.id, tid)
      this.profiles.set(tid, b.profile ?? 'default')
      this.model.addBookmark(tid)
    }
    this.model.setBookmarkOrder(ordered.map((b) => this.bmTabId.get(b.id)!))
    if (destroyedAttached && !this.model.activeId) {
      this.createTab()
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

  // immediate prev/next in sidebar order with wraparound — unlike Ctrl+Tab MRU
  // cycling there is no preview/commit phase. Pins and bookmark slots are not
  // in `order`; when one is active, dir 1 starts at the first order tab and
  // dir -1 at the last.
  activateSibling(dir: 1 | -1): void {
    const order = this.model.order
    if (order.length === 0) return
    const i = this.model.activeId ? order.indexOf(this.model.activeId) : -1
    const next = i === -1 ? (dir === 1 ? 0 : order.length - 1) : (i + dir + order.length) % order.length
    this.activateTab(order[next]!)
  }

  refresh(): void {
    this.opts.onSnapshot(this.snapshot())
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
    return {
      tabs,
      order: [...this.model.order],
      pinned: [...this.model.pinned],
      bookmarkTabs,
      activeId: this.model.activeId,
    }
  }

  private syncViews(): void {
    const active =
      !this.settingsOpen && this.model.activeId
        ? (this.views.get(this.model.activeId) ?? null)
        : null
    if (this.attached !== active) {
      if (this.attached) this.win.contentView.removeChildView(this.attached)
      if (active) this.win.contentView.addChildView(active)
      this.attached = active
      if (active) this.opts.onTabActivated?.(active.webContents, this.profileOf(this.model.activeId!))
    }
    this.layout()
    this.refresh()
  }

  private layout(): void {
    if (!this.attached) return
    const [w, h] = this.win.getContentSize()
    const top = TOPBAR_HEIGHT + this.overlayHeight
    const left = this.sidebarVisible ? this.sidebarWidth : 0
    this.attached.setBounds({
      x: left,
      y: top,
      width: Math.max(0, w - left),
      height: Math.max(0, h - top),
    })
  }

  private wireEvents(id: string, wc: WebContents): void {
    const refresh = () => this.refresh()
    wc.on('page-title-updated', refresh)
    wc.on('did-start-loading', refresh)
    wc.on('did-stop-loading', refresh)
    wc.on('did-navigate', () => {
      this.favicons.set(id, null)
      this.refresh()
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      this.favicons.set(id, favicons[0] ?? null)
      const bid = this.bookmarkIdOf(id)
      if (bid) this.opts.onBookmarkFavicon(bid, favicons[0] ?? null)
      this.refresh()
    })
    wc.on('did-finish-load', () => {
      this.opts.onNavigated(wc.getURL(), wc.getTitle() || wc.getURL())
      this.refresh()
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) this.opts.onNavigated(url, wc.getTitle() || url)
      this.refresh()
    })
    wc.on('did-fail-load', (_e, code, desc, validatedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return // -3 = user/redirect abort, not an error
      if (validatedUrl.startsWith('data:')) return // the error page itself failed; don't loop
      wc.loadURL(errorPageDataUrl(desc || `Error ${code}`, validatedUrl))
    })
    wc.on('render-process-gone', (_e, details) => {
      if (wc.getURL().startsWith('data:')) return // error page crashed; don't loop
      wc.loadURL(errorPageDataUrl(`Page crashed (${details.reason})`, wc.getURL()))
    })
  }
}
