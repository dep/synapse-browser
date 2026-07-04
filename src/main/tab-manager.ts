import { BrowserWindow, WebContents, WebContentsView } from 'electron'
import { classifyInput } from '../shared/url-classifier'
import type { TabInfo, TabsSnapshot } from '../shared/ipc'
import { CycleList, Direction, TabModel } from './tab-model'
import { errorPageDataUrl } from './error-page'

export const SIDEBAR_WIDTH = 240
export const TOPBAR_HEIGHT = 52

export interface TabManagerOptions {
  isBookmarked(url: string): boolean
  onNavigated(url: string, title: string): void
  onSnapshot(snap: TabsSnapshot): void
  onTabCreated?(wc: WebContents): void
}

export class TabManager {
  private model = new TabModel()
  private views = new Map<string, WebContentsView>()
  private favicons = new Map<string, string | null>()
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

  createTab(url?: string, activate = true): string {
    const id = `tab-${++this.counter}`
    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true },
    })
    this.views.set(id, view)
    this.favicons.set(id, null)
    this.model.add(id, activate)
    this.wireEvents(id, view.webContents)
    this.opts.onTabCreated?.(view.webContents)
    view.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
      if (/^https?:\/\//.test(popupUrl)) this.createTab(popupUrl)
      return { action: 'deny' }
    })
    if (url) view.webContents.loadURL(classifyInput(url))
    else if (activate) this.focusUrlBar()
    this.syncViews()
    return id
  }

  closeTab(id: string): void {
    const view = this.views.get(id)
    if (!view) return
    const wasAttached = this.attached === view
    this.model.close(id)
    this.views.delete(id)
    this.favicons.delete(id)
    if (wasAttached) {
      this.win.contentView.removeChildView(view)
      this.attached = null
    }
    view.webContents.close()
    if (this.model.order.length === 0) {
      this.createTab()
      return
    }
    this.syncViews()
    // destroying the focused view leaves no first responder, and Blink then
    // parks keyboard focus on the chrome toolbar's first enabled button
    if (wasAttached) this.attached?.webContents.focus()
  }

  activateTab(id: string): void {
    if (!this.views.has(id)) return
    this.model.activate(id)
    this.syncViews()
    this.attached?.webContents.focus()
  }

  // recreate a saved session: tabs in sidebar order, then the active one
  restoreTabs(urls: string[], active: number): void {
    if (urls.length === 0) {
      this.createTab()
      return
    }
    const ids = urls.map((url) => this.createTab(url || undefined, false))
    this.activateTab(ids[Math.min(Math.max(active, 0), ids.length - 1)]!)
  }

  // index into sidebar order; negative counts from the end (-1 = last tab)
  activateAt(index: number): void {
    const id = this.model.order.at(index)
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
    for (const id of this.model.order) {
      const wc = this.views.get(id)!.webContents
      const url = wc.getURL()
      tabs[id] = {
        id,
        title: wc.getTitle() || 'New Tab',
        url,
        favicon: this.favicons.get(id) ?? null,
        isLoading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        isBookmarked: this.opts.isBookmarked(url),
      }
    }
    return { tabs, order: [...this.model.order], activeId: this.model.activeId }
  }

  private syncViews(): void {
    const active = this.model.activeId ? (this.views.get(this.model.activeId) ?? null) : null
    if (this.attached !== active) {
      if (this.attached) this.win.contentView.removeChildView(this.attached)
      if (active) this.win.contentView.addChildView(active)
      this.attached = active
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
