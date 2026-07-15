import { BrowserWindow, WebContentsView } from 'electron'
import { join } from 'path'
import type { SuggestionsPayload } from '../shared/ipc'

// The urlbar dropdown as a native view. WebContentsViews always draw above
// the window's own renderer, so a dropdown drawn by the chrome document can
// never overlap a page — shifting the page down was the old workaround
// (issue #23). Instead the dropdown is itself a view stacked above the page
// view. The chrome renderer owns all suggestion state (fetch, autofill,
// keyboard selection) and streams rows here; this class only loads the
// document and positions/shows/raises the view.
export class SuggestionsOverlay {
  private view: WebContentsView
  private attached = false
  private open = false
  private ready = false
  private gen = 0
  private pending: SuggestionsPayload | null = null
  private anchor = { x: 0, y: 0, width: 0 }

  constructor(private win: BrowserWindow) {
    this.view = new WebContentsView({
      // minimal dedicated preload: this document renders page-controlled
      // strings and must not see the full SynapseApi
      webPreferences: { preload: join(__dirname, '../preload/suggestions.js') },
    })
    this.view.setBorderRadius(8) // --r-m, matched by the inset ring in suggestions.css
    const wc = this.view.webContents
    // renders sent before the document registered its listener would be
    // dropped silently; hold the latest payload until the load lands
    wc.on('did-finish-load', () => {
      this.ready = true
      const p = this.pending
      this.pending = null
      if (p) this.update(p)
    })
    // a crashed overlay renderer must not kill suggestions for the session
    wc.on('render-process-gone', () => {
      this.ready = false
      this.hide()
      this.load()
    })
    // the dropdown must not outlive the chrome document that opened it
    win.webContents.on('render-process-gone', () => this.hide())
    win.webContents.on('did-navigate', () => this.hide())
    // resize: hide immediately (Chrome does the same) — the chrome renderer's
    // ResizeObserver re-anchors and re-shows it while the window is visible
    win.on('resize', () => this.hide())
    win.on('closed', () => wc.close())
    this.load()
  }

  private load(): void {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (dev) void this.view.webContents.loadURL(`${dev}/suggestions.html`)
    else void this.view.webContents.loadFile(join(__dirname, '../renderer/suggestions.html'))
  }

  update(p: SuggestionsPayload): void {
    if (p.items.length === 0) {
      this.hide()
      return
    }
    this.open = true
    this.anchor = p.anchor
    if (!this.ready) {
      this.pending = p
      return
    }
    this.view.webContents.send('sugg:render', { ...p, gen: ++this.gen })
  }

  // The overlay echoes its rendered height per generation; only then is the
  // view sized and attached, so it never shows at a stale size — a reply for
  // a superseded render (typed past, escaped, reopened) is ignored.
  // Re-adding an existing child also raises it above any page view attached
  // in the meantime.
  setHeight(px: number, gen: number): void {
    if (!this.open || gen !== this.gen || px <= 0) return
    const [, winH] = this.win.getContentSize()
    this.view.setBounds({
      x: Math.round(this.anchor.x),
      y: Math.round(this.anchor.y),
      width: Math.round(this.anchor.width),
      height: Math.min(Math.round(px), Math.max(0, winH - Math.round(this.anchor.y) - 8)),
    })
    this.win.contentView.addChildView(this.view)
    this.attached = true
  }

  hide(): void {
    this.open = false
    this.pending = null
    if (!this.attached) return
    this.win.contentView.removeChildView(this.view)
    this.attached = false
  }
}
