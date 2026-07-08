import { screen } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { clampSidebarWidth } from '../shared/sidebar-width'

export interface SidebarResizeOptions {
  win: BrowserWindow
  getPageWebContents(): WebContents | null
  onWidth(px: number): void
  onCommit(px: number): void
}

// Mouse events over a WebContentsView never reach the chrome renderer —
// native views draw and hit-test above the window's own web contents — so
// once the cursor crosses into the page a renderer-tracked drag stalls.
// The renderer therefore only initiates; main tracks the cursor by polling.
export class SidebarResizeController {
  private timer: ReturnType<typeof setInterval> | null = null
  private tracked: WebContents[] = []
  private width: number

  constructor(
    private opts: SidebarResizeOptions,
    initialWidth: number,
  ) {
    this.width = clampSidebarWidth(initialWidth)
    // a release outside the window delivers no mouseUp to any of our surfaces
    opts.win.on('blur', () => this.end())
  }

  get current(): number {
    return this.width
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.track(), 16)
    // watch both surfaces for the release: chrome UI (cursor over sidebar /
    // topbar) and the active page view (cursor over the page)
    for (const wc of [this.opts.win.webContents, this.opts.getPageWebContents()]) {
      if (!wc || wc.isDestroyed()) continue
      wc.on('input-event', this.onInputEvent)
      this.tracked.push(wc)
    }
  }

  end(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    for (const wc of this.tracked) {
      if (!wc.isDestroyed()) wc.removeListener('input-event', this.onInputEvent)
    }
    this.tracked = []
    this.opts.onCommit(this.width)
  }

  private onInputEvent = (_e: Electron.Event, input: Electron.InputEvent): void => {
    // a move without the left button means the mouseUp happened where we
    // couldn't see it (e.g. outside the window) — treat it as the release
    const released =
      input.type === 'mouseUp' ||
      (input.type === 'mouseMove' && !(input.modifiers ?? []).includes('leftbuttondown'))
    if (released) this.end()
  }

  private track(): void {
    const cursorX = screen.getCursorScreenPoint().x
    const contentLeft = this.opts.win.getContentBounds().x
    const width = clampSidebarWidth(cursorX - contentLeft)
    if (width === this.width) return
    this.width = width
    this.opts.onWidth(width)
  }
}
