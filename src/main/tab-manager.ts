import { BrowserWindow, WebContents, WebContentsView } from 'electron'
import { classifyInput, isHttpUrl } from '../shared/url-classifier'
import { CANVAS_RADIUS, computeCanvasBounds } from '../shared/canvas-layout'
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
  private overlayHeight = 0
  private htmlFullscreenId: string | null = null
  private findText = ''
  private sidebarWidth = SIDEBAR_WIDTH_DEFAULT
  private sidebarVisible = true
  private aiSidebarWidth = AI_SIDEBAR_WIDTH_DEFAULT
  private aiSidebarVisible = false
  private settingsOpen = false
  private blankActivatedId: string | null = null

  constructor(
    private win: BrowserWindow,
    private opts: TabManagerOptions,
  ) {
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
    wc.on('did-create-window', (child) => this.wirePopupRouting(child.webContents, openerId))
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
    this.views.delete(id)
    this.favicons.delete(id)
    if (wasAttached) {
      this.findText = ''
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
    // a blank active tab attaches no view, leaving the chrome renderer's
    // new-tab page visible in the page cell (same mechanism as settings).
    // A loading tab counts as a page tab even while getURL() is still '' —
    // a fresh view's first navigation hasn't committed yet, and waiting for
    // the URL would leave the view detached (and steal focus to the urlbar).
    const activeView =
      !this.settingsOpen && this.model.activeId
        ? (this.views.get(this.model.activeId) ?? null)
        : null
    const active =
      activeView &&
      (!isBlankUrl(activeView.webContents.getURL()) || activeView.webContents.isLoading())
        ? activeView
        : null
    if (this.attached !== active) {
      if (this.attached && this.findText) {
        this.attached.webContents.stopFindInPage('clearSelection')
        this.findText = ''
      }
      if (this.attached) this.win.contentView.removeChildView(this.attached)
      if (active) this.win.contentView.addChildView(active)
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
    if (!this.attached) return
    const [w, h] = this.win.getContentSize()
    if (this.htmlFullscreenId && this.htmlFullscreenId === this.model.activeId) {
      this.attached.setBounds({ x: 0, y: 0, width: w, height: h })
      return
    }
    this.attached.setBounds(
      computeCanvasBounds(w, h, {
        topbar: TOPBAR_HEIGHT,
        overlay: this.overlayHeight,
        sidebar: this.sidebarVisible ? this.sidebarWidth : 0,
        ai: this.aiSidebarVisible ? this.aiSidebarWidth : 0,
      }),
    )
  }

  private wireEvents(id: string, wc: WebContents): void {
    const refresh = () => this.refresh()
    // HTML fullscreen (video players) must escape the carved canvas: drop the
    // rounded mask and fill the window, then restore the inset on leave
    wc.on('enter-html-full-screen', () => {
      this.htmlFullscreenId = id
      this.views.get(id)?.setBorderRadius(0)
      this.layout()
    })
    wc.on('leave-html-full-screen', () => {
      if (this.htmlFullscreenId === id) this.htmlFullscreenId = null
      this.views.get(id)?.setBorderRadius(CANVAS_RADIUS)
      this.layout()
    })
    wc.on('page-title-updated', refresh)
    // attach/detach must be re-evaluated at every loading transition and at
    // commit, not just load start: a fresh view reports a blank getURL()
    // until its first navigation commits, so any single check can race and
    // leave an active tab's view detached — a blank page (issue #24).
    // syncViews ends with refresh(), so these are supersets of refresh.
    wc.on('did-start-loading', () => this.syncViews())
    wc.on('did-stop-loading', () => this.syncViews())
    wc.on('did-navigate', () => {
      this.favicons.set(id, null)
      this.syncViews()
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      this.favicons.set(id, favicons[0] ?? null)
      const bid = this.bookmarkIdOf(id)
      if (bid) this.opts.onBookmarkFavicon(bid, favicons[0] ?? null)
      this.opts.onPageFavicon(wc.getURL(), favicons[0] ?? null)
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
    wc.on('found-in-page', (_e, result) => {
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
    wc.on('destroyed', () => {
      if (this.views.get(id)?.webContents !== wc) return
      this.dropDeadView(id)
      if (!this.model.activeId) {
        this.createTab()
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
    this.views.delete(id)
    this.favicons.delete(id)
    if (this.attached && isDeadView(this.attached)) {
      this.win.contentView.removeChildView(this.attached)
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
