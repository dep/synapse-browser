import { describe, expect, it } from 'vitest'
import { staleTabs, UNLOAD_AFTER_MS } from '../src/shared/tab-unload'
import type { UnloadCandidate } from '../src/shared/tab-unload'

const HOUR = 60 * 60 * 1000
const NOW = 10 * 24 * HOUR

const tab = (id: string, over: Partial<UnloadCandidate> = {}): UnloadCandidate => ({
  id,
  lastActiveAt: NOW - 5 * HOUR, // stale by default
  isActive: false,
  isVisible: false,
  isAudible: false,
  isLoading: false,
  ...over,
})

describe('staleTabs', () => {
  it('picks tabs idle past the threshold', () => {
    const picked = staleTabs([tab('a'), tab('b', { lastActiveAt: NOW - HOUR })], NOW)
    expect(picked).toEqual(['a'])
  })

  it('the threshold is inclusive at exactly 4 hours', () => {
    expect(staleTabs([tab('a', { lastActiveAt: NOW - UNLOAD_AFTER_MS })], NOW)).toEqual(['a'])
    expect(staleTabs([tab('b', { lastActiveAt: NOW - UNLOAD_AFTER_MS + 1 })], NOW)).toEqual([])
  })

  it('never unloads the active tab, visible panes, audible or loading tabs', () => {
    const picked = staleTabs(
      [
        tab('active', { isActive: true }),
        tab('pane', { isVisible: true }),
        tab('music', { isAudible: true }),
        tab('loading', { isLoading: true }),
        tab('idle'),
      ],
      NOW,
    )
    expect(picked).toEqual(['idle'])
  })

  it('returns nothing for no candidates', () => {
    expect(staleTabs([], NOW)).toEqual([])
  })
})
