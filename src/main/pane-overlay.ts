import { BrowserWindow, WebContents, WebContentsView } from 'electron'
import { join } from 'path'
import type { PaneRect } from '../shared/split-layout'

// Per-pane close buttons. Chrome-document UI can never overlap a page
// (WebContentsViews draw above the window's own renderer), so each split
// pane gets a tiny native view pinned to its top-right corner — the same
// mechanism as the suggestions overlay, just one per pane. The button's
// document only knows how to say "close me"; main maps the sender back to
// the pane id here.
const BUTTON_SIZE = 24
const BUTTON_MARGIN = 8

export class PaneOverlays {
  private buttons = new Map<string, WebContentsView>() // pane tab id → button view

  constructor(private win: BrowserWindow) {}

  // Reconcile one button per pane and pin it to the pane's corner. An empty
  // list (no split, settings open, HTML fullscreen) removes them all.
  // Existing buttons are only repositioned — raising above later-attached
  // pane views is raise()'s job, so live resizes stay cheap setBounds calls.
  sync(rects: PaneRect[]): void {
    if (this.win.isDestroyed()) return
    const want = new Set(rects.map((r) => r.id))
    for (const [id, view] of [...this.buttons]) {
      if (want.has(id)) continue
      this.win.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
      this.buttons.delete(id)
    }
    for (const { id, rect } of rects) {
      let view = this.buttons.get(id)
      if (!view) {
        view = new WebContentsView({
          webPreferences: { preload: join(__dirname, '../preload/pane.js') },
        })
        view.setBackgroundColor('#00000000')
        const dev = process.env['ELECTRON_RENDERER_URL']
        if (dev) void view.webContents.loadURL(`${dev}/pane.html`)
        else void view.webContents.loadFile(join(__dirname, '../renderer/pane.html'))
        this.buttons.set(id, view)
        this.win.contentView.addChildView(view)
      }
      view.setBounds({
        x: rect.x + rect.width - BUTTON_SIZE - BUTTON_MARGIN,
        y: rect.y + BUTTON_MARGIN,
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
      })
    }
  }

  // re-adding an existing child raises it; called after pane views attach
  raise(): void {
    if (this.win.isDestroyed()) return
    for (const view of this.buttons.values()) this.win.contentView.addChildView(view)
  }

  // resolve a pane:close sender to its pane; null if this window doesn't own it
  paneIdFor(wc: WebContents): string | null {
    for (const [id, view] of this.buttons) if (view.webContents === wc) return id
    return null
  }

  dispose(): void {
    for (const view of this.buttons.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close()
    }
    this.buttons.clear()
  }
}
