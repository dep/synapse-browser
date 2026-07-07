import { BrowserWindow, WebContents, WebContentsView } from 'electron'
import { classifyInput } from '../shared/url-classifier'
import type { PinSlot, ProfileId, TabInfo, TabsSnapshot } from '../shared/ipc'
import { CycleList, Direction, TabModel } from './tab-model'
import { errorPageDataUrl } from './error-page'

export const SIDEBAR_WIDTH = 240
export const TOPBAR_HEIGHT = 52
export const WORK_PARTITION = 'persist:profile-work'

export interface TabManagerOptions {
  isBookmarked(url: string): boolean
  onNavigated(url: string, title: string): void
  onSnapshot(snap: TabsSnapshot): void
  onTabCreated?(wc: WebContents, profile: ProfileId): void
  onTabActivated?(wc: WebContents, profile: ProfileId): void
}

export class TabManager {
  private model = new TabModel()
  private views = new Map<string, WebContentsView>()
  private favicons = new Map<string, string | null>()
  private pins = new Map<string, PinSlot>()
  private profiles = new Map<string, ProfileId>()
  private anchors = new Map<string, string>()
  private attached: WebContentsView | null = null
  private overlayHeight = 0
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
    if (this.model.isPinned(id)) {
      this.sleepPin(id)
      return
    }
    const view = this.views.get(id)
    if (!view) return
    const wasAttached = this.attached === view
    this.model.close(id)
    this.destroyView(id, view, wasAttached)
    this.profiles.delete(id)
    this.anchors.delete(id)
    if (!this.model.activeId) {
      this.createTab()
      return
    }
    this.syncViews()
    // destroying the focused view leaves no first responder, and Blink then
    // parks keyboard focus on the chrome toolbar's first enabled button
    if (wasAttached) this.attached?.webContents.focus()
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

  private sleepPin(id: string): void {
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
    if (this.model.isPinned(id) && !this.views.has(id)) {
      this.wakePin(id)
      return
    }
    if (!this.views.has(id)) return
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

  // recreate a saved session: tabs in sidebar order, then the active one
  restoreTabs(tabs: { url: string; profile: ProfileId; anchor?: string }[], active: number): void {
    if (tabs.length === 0) {
      this.createTab()
      return
    }
    const ids = tabs.map((t) => {
      const id = this.createTab(t.url || undefined, false, t.profile)
      if (t.anchor) this.anchors.set(id, t.anchor)
      return id
    })
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
      this.pins.set(id, {
        url,
        title: wc.getTitle() || url,
        favicon: this.favicons.get(id) ?? null,
        profile: this.profileOf(id),
      })
      this.model.pin(id)
    }
    this.syncViews()
  }

  profileOf(id: string): ProfileId {
    return this.profiles.get(id) ?? 'default'
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

  // open a bookmark pin-style: refocus the tab already carrying it, else
  // create one anchored to it. Pinned slots win over anchors when both match.
  openBookmark(url: string): void {
    for (const [id, slot] of this.pins) {
      if (slot.url === url) return this.activateTab(id)
    }
    for (const [id, anchor] of this.anchors) {
      if (anchor === url) return this.activateTab(id)
    }
    const id = this.createTab(url)
    this.anchors.set(id, url)
    this.refresh()
  }

  restoreAnchor(id: string | null = this.model.activeId): void {
    if (!id) return
    const url = this.pins.get(id)?.url ?? this.anchors.get(id)
    if (url) this.views.get(id)?.webContents.loadURL(url)
  }

  isAnchored(id: string): boolean {
    return this.anchors.has(id)
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
    if (!id) return null
    const wc = this.views.get(id)!.webContents
    return { url: wc.getURL(), title: wc.getTitle() || wc.getURL() }
  }

  setOverlayHeight(px: number): void {
    this.overlayHeight = Math.max(0, Math.round(px))
    this.layout()
  }

  refresh(): void {
    this.opts.onSnapshot(this.snapshot())
  }

  private snapshot(): TabsSnapshot {
    const tabs: Record<string, TabInfo> = {}
    for (const id of [...this.model.pinned, ...this.model.order]) {
      const slot = this.pins.get(id)
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
          isBookmarked: this.opts.isBookmarked(url),
          isPinned: !!slot,
          isAsleep: false,
          anchorUrl: slot?.url ?? this.anchors.get(id) ?? null,
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
          isBookmarked: this.opts.isBookmarked(slot.url),
          isPinned: true,
          isAsleep: true,
          anchorUrl: slot.url,
          profile: this.profileOf(id),
        }
      }
    }
    return {
      tabs,
      order: [...this.model.order],
      pinned: [...this.model.pinned],
      activeId: this.model.activeId,
    }
  }

  private syncViews(): void {
    const active = this.model.activeId ? (this.views.get(this.model.activeId) ?? null) : null
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
    this.attached.setBounds({
      x: SIDEBAR_WIDTH,
      y: top,
      width: Math.max(0, w - SIDEBAR_WIDTH),
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
