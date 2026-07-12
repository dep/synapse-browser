import { describe, expect, it } from 'vitest'
import { CANVAS_GAP, computeCanvasBounds } from '../src/shared/canvas-layout'

describe('computeCanvasBounds', () => {
  it('insets the page view by the gap on all sides inside the chrome', () => {
    const b = computeCanvasBounds(1200, 800, { topbar: 52, overlay: 0, sidebar: 240, ai: 0 })
    expect(b).toEqual({
      x: 240 + CANVAS_GAP,
      y: 52 + CANVAS_GAP,
      width: 1200 - 240 - CANVAS_GAP * 2,
      height: 800 - 52 - CANVAS_GAP * 2,
    })
  })

  it('adds the overlay shift below the topbar', () => {
    const b = computeCanvasBounds(1200, 800, { topbar: 52, overlay: 120, sidebar: 240, ai: 0 })
    expect(b.y).toBe(52 + 120 + CANVAS_GAP)
    expect(b.height).toBe(800 - 52 - 120 - CANVAS_GAP * 2)
  })

  it('handles hidden sidebar and visible AI sidebar', () => {
    const b = computeCanvasBounds(1200, 800, { topbar: 52, overlay: 0, sidebar: 0, ai: 360 })
    expect(b.x).toBe(CANVAS_GAP)
    expect(b.width).toBe(1200 - 360 - CANVAS_GAP * 2)
  })

  it('clamps width/height at 0 for tiny windows', () => {
    const b = computeCanvasBounds(200, 40, { topbar: 52, overlay: 0, sidebar: 240, ai: 0 })
    expect(b.width).toBe(0)
    expect(b.height).toBe(0)
  })
})
