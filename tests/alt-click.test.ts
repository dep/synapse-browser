import { describe, expect, it } from 'vitest'
import { ALT_CLICK_ARM_MS, AltClickTracker } from '../src/shared/alt-click'

// One tracker per window. Keyboard events (from any of the window's
// webContents) maintain a single alt-held flag; a mouseDown on a page tab
// while alt is held arms that tab. consume() answers "was this tab's
// will-download caused by a recent alt-click?" — at most once per click.

function altClick(t: AltClickTracker, wcId: number, now: number): void {
  t.noteKey('keyDown', 'Alt', true)
  t.noteMouse(wcId, 'mouseDown', 'left', now)
}

describe('AltClickTracker', () => {
  it('arms a tab on mouseDown while Alt is held and consumes once', () => {
    const t = new AltClickTracker()
    altClick(t, 7, 1000)
    expect(t.consume(7, 1500)).toBe(true)
    // a second download from the same click must not be claimed
    expect(t.consume(7, 1600)).toBe(false)
  })

  it('does not arm on a plain mouseDown', () => {
    const t = new AltClickTracker()
    t.noteMouse(7, 'mouseDown', 'left', 1000)
    expect(t.consume(7, 1100)).toBe(false)
  })

  it('a later plain mouseDown disarms a previous alt-click', () => {
    const t = new AltClickTracker()
    altClick(t, 7, 1000)
    t.noteKey('keyUp', 'Alt', false)
    t.noteMouse(7, 'mouseDown', 'left', 1200)
    expect(t.consume(7, 1300)).toBe(false)
  })

  it('expires after ALT_CLICK_ARM_MS', () => {
    const t = new AltClickTracker()
    altClick(t, 7, 1000)
    expect(t.consume(7, 1000 + ALT_CLICK_ARM_MS + 1)).toBe(false)
  })

  it('arming is per-tab: a download from another tab is not claimed', () => {
    const t = new AltClickTracker()
    altClick(t, 7, 1000)
    expect(t.consume(8, 1100)).toBe(false)
    // the miss on tab 8 must not eat tab 7's arm
    expect(t.consume(7, 1200)).toBe(true)
  })

  it('mouseUp and other input types never arm', () => {
    const t = new AltClickTracker()
    t.noteKey('keyDown', 'Alt', true)
    t.noteMouse(7, 'mouseUp', 'left', 1000)
    t.noteMouse(7, 'mouseMove', 'left', 1001)
    expect(t.consume(7, 1100)).toBe(false)
  })

  it('Alt keyUp clears the held state before a click', () => {
    const t = new AltClickTracker()
    t.noteKey('keyDown', 'Alt', true)
    t.noteKey('keyUp', 'Alt', false)
    t.noteMouse(7, 'mouseDown', 'left', 1000)
    expect(t.consume(7, 1100)).toBe(false)
  })

  it('heals a missed Alt keyUp from any later key event reporting alt=false', () => {
    const t = new AltClickTracker()
    t.noteKey('keyDown', 'Alt', true)
    // window lost focus, Alt released unseen; user types a plain key later
    t.noteKey('keyDown', 'a', false)
    t.noteMouse(7, 'mouseDown', 'left', 1000)
    expect(t.consume(7, 1100)).toBe(false)
  })

  it('non-Alt keys pressed while Alt is held keep the held state', () => {
    const t = new AltClickTracker()
    t.noteKey('keyDown', 'Alt', true)
    t.noteKey('keyDown', 'a', true)
    t.noteMouse(7, 'mouseDown', 'left', 1000)
    expect(t.consume(7, 1100)).toBe(true)
  })

  it('rawKeyDown also sets the held state', () => {
    const t = new AltClickTracker()
    t.noteKey('rawKeyDown', 'Alt', true)
    t.noteMouse(7, 'mouseDown', 'left', 1000)
    expect(t.consume(7, 1100)).toBe(true)
  })

  it('a right-click while Alt is held never arms (Save Link As… stays a download)', () => {
    const t = new AltClickTracker()
    t.noteKey('keyDown', 'Alt', true)
    t.noteMouse(7, 'mouseDown', 'right', 1000)
    expect(t.consume(7, 1100)).toBe(false)
  })

  it('a right-click does not disarm an in-flight alt-click', () => {
    const t = new AltClickTracker()
    altClick(t, 7, 1000)
    t.noteMouse(7, 'mouseDown', 'right', 1100)
    expect(t.consume(7, 1200)).toBe(true)
  })

  it('forget() drops both alt-arm and any pending state for a tab', () => {
    const t = new AltClickTracker()
    altClick(t, 7, 1000)
    t.forget(7)
    expect(t.consume(7, 1100)).toBe(false)
  })
})
