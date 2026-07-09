import { describe, expect, it } from 'vitest'
import { FINISH_FADE_MS, SHOW_DELAY_MS, progressAt } from '../src/shared/load-progress'

describe('progressAt', () => {
  it('starts at the 25% floor', () => {
    expect(progressAt(0)).toBeCloseTo(0.25, 5)
  })

  it('is monotonically increasing', () => {
    let prev = -1
    for (const t of [0, 100, 500, 1000, 2500, 5000, 10000, 60000]) {
      const p = progressAt(t)
      expect(p).toBeGreaterThan(prev)
      prev = p
    }
  })

  it('never exceeds the 85% ceiling', () => {
    expect(progressAt(60_000)).toBeLessThan(0.85)
    expect(progressAt(Number.MAX_SAFE_INTEGER)).toBeLessThanOrEqual(0.85)
  })

  it('approaches the ceiling asymptotically', () => {
    expect(progressAt(10_000)).toBeGreaterThan(0.83)
  })

  it('clamps negative elapsed to the floor', () => {
    expect(progressAt(-50)).toBeCloseTo(0.25, 5)
  })
})

describe('constants', () => {
  it('exports sane timing constants', () => {
    expect(SHOW_DELAY_MS).toBe(150)
    expect(FINISH_FADE_MS).toBe(250)
  })
})
