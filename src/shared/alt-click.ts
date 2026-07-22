// Alt-click → split pane (issue #39). Sandboxed page tabs get no preload, so
// an alt-click never reaches us as a DOM event. Chromium instead treats
// alt-click on a link as "save link": the renderer asks the browser to
// download the href, which surfaces in main as a session will-download. This
// tracker pairs that download back to the click that caused it.
//
// Two signals, because neither alone is enough: 'input-event' delivers the
// mouseDown but carries no modifiers (verified on Electron 43), and
// before-input-event carries modifiers but only for keyboard events. So
// keyboard events maintain one alt-held flag per window (chrome and page
// webContents both feed it — the Alt press can land while the urlbar has
// focus), and a mouseDown on a page tab while the flag is up arms that tab
// for a short window.
//
// Arming is per-tab and consumed at most once per click: when the opened
// pane's URL turns out to be a direct file download, ITS will-download comes
// from a tab that was never armed, so it downloads normally instead of
// splitting again in a loop.

export const ALT_CLICK_ARM_MS = 3000

export class AltClickTracker {
  private altHeld = false
  private armedAt = new Map<number, number>() // page wc.id → mouseDown time

  // every keyboard event from any of the window's webContents
  noteKey(type: string, key: string, alt: boolean): void {
    // non-Alt events report the live modifier state, healing a missed keyUp
    // (e.g. Alt released while the window was blurred)
    this.altHeld = key === 'Alt' ? type !== 'keyUp' : alt
  }

  // every 'input-event' from a page tab's webContents. Only LEFT mouseDowns
  // touch the arm state: a right-click's "Save Link As…" must never be
  // claimed just because Alt happened to be held, and it must not disarm a
  // legit alt-click whose download is still in flight either.
  noteMouse(wcId: number, type: string, button: string | undefined, now: number): void {
    if (type !== 'mouseDown' || button !== 'left') return
    if (this.altHeld) this.armedAt.set(wcId, now)
    else this.armedAt.delete(wcId)
  }

  // a will-download originating from this tab: true = claimed by an alt-click
  consume(wcId: number, now: number): boolean {
    const t = this.armedAt.get(wcId)
    if (t === undefined) return false
    this.armedAt.delete(wcId)
    return now - t <= ALT_CLICK_ARM_MS
  }

  forget(wcId: number): void {
    this.armedAt.delete(wcId)
  }
}
