import { describe, expect, it } from 'vitest'
import { nextTabId } from '../src/main/tab-ids'

describe('nextTabId', () => {
  it('mints unique ids across many calls (cross-manager contract)', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => nextTabId()))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(id).toMatch(/^tab-\d+$/)
  })
})
