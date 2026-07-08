import { describe, expect, it } from 'vitest'
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  clampSidebarWidth,
} from '../src/shared/sidebar-width'

describe('clampSidebarWidth', () => {
  it('passes through in-range widths, rounded to whole pixels', () => {
    expect(clampSidebarWidth(300)).toBe(300)
    expect(clampSidebarWidth(300.6)).toBe(301)
  })

  it('clamps below the minimum', () => {
    expect(clampSidebarWidth(0)).toBe(SIDEBAR_WIDTH_MIN)
    expect(clampSidebarWidth(-50)).toBe(SIDEBAR_WIDTH_MIN)
  })

  it('clamps above the maximum', () => {
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_WIDTH_MAX)
  })

  it('maps non-finite input to the default', () => {
    expect(clampSidebarWidth(NaN)).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(clampSidebarWidth(Infinity)).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  it('keeps the default inside the range', () => {
    expect(SIDEBAR_WIDTH_DEFAULT).toBeGreaterThanOrEqual(SIDEBAR_WIDTH_MIN)
    expect(SIDEBAR_WIDTH_DEFAULT).toBeLessThanOrEqual(SIDEBAR_WIDTH_MAX)
  })
})
