import { describe, expect, it } from 'vitest'
import { droppedOutsideViewport } from '../src/shared/drag-out'

describe('droppedOutsideViewport', () => {
  it('inside the viewport (edges inclusive) is not outside', () => {
    expect(droppedOutsideViewport({ clientX: 10, clientY: 10 }, 800, 600)).toBe(false)
    expect(droppedOutsideViewport({ clientX: 0, clientY: 0 }, 800, 600)).toBe(false)
    expect(droppedOutsideViewport({ clientX: 800, clientY: 600 }, 800, 600)).toBe(false)
  })

  it('any coordinate beyond an edge is outside', () => {
    expect(droppedOutsideViewport({ clientX: -1, clientY: 10 }, 800, 600)).toBe(true)
    expect(droppedOutsideViewport({ clientX: 10, clientY: -5 }, 800, 600)).toBe(true)
    expect(droppedOutsideViewport({ clientX: 801, clientY: 10 }, 800, 600)).toBe(true)
    expect(droppedOutsideViewport({ clientX: 10, clientY: 601 }, 800, 600)).toBe(true)
  })
})
