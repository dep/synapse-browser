import { beforeEach, describe, expect, it } from 'vitest'
import { TabModel } from '../src/main/tab-model'

describe('TabModel', () => {
  let m: TabModel

  beforeEach(() => {
    m = new TabModel()
    m.add('a')
    m.add('b')
    m.add('c') // activation order a, b, c → mru [c, b, a]
  })

  it('activates each added tab by default', () => {
    expect(m.order).toEqual(['a', 'b', 'c'])
    expect(m.mru).toEqual(['c', 'b', 'a'])
    expect(m.activeId).toBe('c')
  })

  it('adds background tabs at the MRU tail without activating', () => {
    m.add('d', false)
    expect(m.activeId).toBe('c')
    expect(m.mru).toEqual(['c', 'b', 'a', 'd'])
  })

  it('activate promotes in MRU', () => {
    m.activate('a')
    expect(m.activeId).toBe('a')
    expect(m.mru).toEqual(['a', 'c', 'b'])
  })

  it('closing the active tab activates its right/below sidebar neighbor', () => {
    m.activate('a')
    m.close('a')
    expect(m.order).toEqual(['b', 'c'])
    expect(m.activeId).toBe('b')
  })

  it('closing the last tab in sidebar order falls back to its new last neighbor', () => {
    m.close('c')
    expect(m.order).toEqual(['a', 'b'])
    expect(m.activeId).toBe('b')
  })

  it('closing a background tab keeps the active tab', () => {
    m.close('a')
    expect(m.activeId).toBe('c')
    expect(m.mru).toEqual(['c', 'b'])
  })

  it('closing the last tab leaves an empty model', () => {
    m.close('a')
    m.close('b')
    m.close('c')
    expect(m.order).toEqual([])
    expect(m.activeId).toBeNull()
  })

  it('quick MRU toggle: step + commit swaps the two most recent tabs', () => {
    expect(m.cycleStep('mru', 'forward')).toBe('b')
    m.cycleCommit()
    expect(m.mru).toEqual(['b', 'c', 'a'])
    expect(m.cycleStep('mru', 'forward')).toBe('c')
    m.cycleCommit()
    expect(m.mru).toEqual(['c', 'b', 'a'])
  })

  it('holding: repeated MRU steps walk deeper without reordering until commit', () => {
    m.cycleStep('mru', 'forward') // preview b
    expect(m.cycleStep('mru', 'forward')).toBe('a') // deeper
    expect(m.mru).toEqual(['c', 'b', 'a']) // unchanged during walk
    m.cycleCommit()
    expect(m.mru).toEqual(['a', 'c', 'b'])
    expect(m.isCycling()).toBe(false)
  })

  it('MRU back steps walk the other way and wrap', () => {
    expect(m.cycleStep('mru', 'back')).toBe('a') // wrap from index 0
  })

  it('order cycling follows sidebar order and wraps', () => {
    expect(m.cycleStep('order', 'forward')).toBe('a') // c wraps to a
    expect(m.cycleStep('order', 'back')).toBe('c')
    expect(m.cycleStep('order', 'back')).toBe('b')
  })

  it('explicit activate commits an in-flight cycle before promoting', () => {
    m.cycleStep('mru', 'forward') // preview b — it was shown, so it counts as a visit
    m.activate('a')
    expect(m.isCycling()).toBe(false)
    m.cycleCommit() // must be a no-op
    expect(m.mru).toEqual(['a', 'b', 'c'])
  })

  // regression: on macOS the modifier keyUp never arrives after a consumed
  // Tab chord, so each new chord begins with a commit of the previous cycle
  it('separate chords toggle MRU when commit is deferred to the next chord', () => {
    const t = new TabModel()
    for (const id of ['1', '2', '3', '4']) t.add(id)
    t.activate('1')
    t.activate('2')
    t.activate('4')
    t.activate('2') // mru [2, 4, 1, 3]
    t.cycleCommit() // chord 1 modifier keyDown: no-op
    expect(t.cycleStep('mru', 'forward')).toBe('4')
    t.cycleCommit() // chord 2 commits chord 1
    expect(t.cycleStep('mru', 'forward')).toBe('2')
    t.cycleCommit() // chord 3
    expect(t.cycleStep('mru', 'forward')).toBe('4')
    t.cycleCommit() // chord 4: hold and walk two steps
    expect(t.cycleStep('mru', 'forward')).toBe('2')
    expect(t.cycleStep('mru', 'forward')).toBe('1')
  })

  it('close during a cycle commits the preview first', () => {
    m.cycleStep('mru', 'forward') // preview b
    m.close('a')
    expect(m.isCycling()).toBe(false)
    expect(m.activeId).toBe('b')
    expect(m.mru).toEqual(['b', 'c'])
  })

  it('closing the previewed tab mid-cycle commits then removes it', () => {
    m.cycleStep('mru', 'forward') // preview b
    m.close('b')
    expect(m.isCycling()).toBe(false)
    expect(m.order).toEqual(['a', 'c'])
    expect(m.activeId).toBe('c')
    expect(m.mru).toEqual(['c', 'a'])
  })

  it('cycleStep is a no-op with fewer than two tabs', () => {
    const solo = new TabModel()
    solo.add('x')
    expect(solo.cycleStep('mru', 'forward')).toBeNull()
    expect(solo.activeId).toBe('x')
  })
})

describe('TabModel pins', () => {
  let m: TabModel

  beforeEach(() => {
    m = new TabModel()
    m.add('a')
    m.add('b')
    m.add('c') // order [a, b, c], mru [c, b, a], active c
  })

  it('pin moves a tab from order to the pinned tail and keeps it awake', () => {
    m.pin('b')
    expect(m.order).toEqual(['a', 'c'])
    expect(m.pinned).toEqual(['b'])
    expect(m.mru).toEqual(['c', 'b', 'a'])
    expect(m.isPinned('b')).toBe(true)
    expect(m.isAwake('b')).toBe(true)
  })

  it('pin appends in pinning order', () => {
    m.pin('b')
    m.pin('a')
    expect(m.pinned).toEqual(['b', 'a'])
    expect(m.order).toEqual(['c'])
  })

  it('pin ignores unknown or already-pinned ids', () => {
    m.pin('b')
    m.pin('b')
    m.pin('nope')
    expect(m.pinned).toEqual(['b'])
    expect(m.order).toEqual(['a', 'c'])
  })

  it('unpin returns the pin to the top of the tab list', () => {
    m.pin('b')
    m.unpin('b')
    expect(m.pinned).toEqual([])
    expect(m.order).toEqual(['b', 'a', 'c'])
    expect(m.mru).toEqual(['c', 'b', 'a'])
  })

  it('restored pins start asleep: listed in pinned, absent from mru', () => {
    m.addPin('p1')
    expect(m.pinned).toEqual(['p1'])
    expect(m.mru).not.toContain('p1')
    expect(m.isAwake('p1')).toBe(false)
    expect(m.activeId).toBe('c')
  })

  it('wake activates and promotes to the MRU front', () => {
    m.addPin('p1')
    m.wake('p1')
    expect(m.activeId).toBe('p1')
    expect(m.mru).toEqual(['p1', 'c', 'b', 'a'])
    expect(m.isAwake('p1')).toBe(true)
  })

  it('wake without activation joins the MRU tail', () => {
    m.addPin('p1')
    m.wake('p1', false)
    expect(m.activeId).toBe('c')
    expect(m.mru).toEqual(['c', 'b', 'a', 'p1'])
  })

  it('wake is a no-op on already-awake or unpinned ids', () => {
    m.pin('b')
    m.wake('b')
    m.wake('a')
    expect(m.mru).toEqual(['c', 'b', 'a'])
    expect(m.activeId).toBe('c')
  })

  it('sleeping the active pin hands off to the MRU front, slot intact', () => {
    m.pin('c') // active pin
    m.sleep('c')
    expect(m.pinned).toEqual(['c'])
    expect(m.mru).toEqual(['b', 'a'])
    expect(m.activeId).toBe('b')
    expect(m.isAwake('c')).toBe(false)
  })

  it('sleeping a background pin keeps the active tab', () => {
    m.pin('a')
    m.sleep('a')
    expect(m.activeId).toBe('c')
    expect(m.mru).toEqual(['c', 'b'])
  })

  it('sleeping the only awake tab leaves no active id', () => {
    const solo = new TabModel()
    solo.add('x')
    solo.pin('x')
    solo.sleep('x')
    expect(solo.activeId).toBeNull()
    expect(solo.pinned).toEqual(['x'])
  })

  it('sleep is a no-op on regular tabs and asleep pins', () => {
    m.addPin('p1')
    m.sleep('p1')
    m.sleep('a')
    expect(m.mru).toEqual(['c', 'b', 'a'])
  })

  it('close is a no-op on pinned ids', () => {
    m.pin('b')
    m.close('b')
    expect(m.pinned).toEqual(['b'])
    expect(m.mru).toContain('b')
  })

  it('activate promotes an awake pin', () => {
    m.pin('a')
    m.activate('a')
    expect(m.activeId).toBe('a')
    expect(m.mru).toEqual(['a', 'c', 'b'])
  })

  it('unpinning a woken pin lands it awake at the top of the list', () => {
    m.addPin('p1')
    m.wake('p1')
    m.unpin('p1')
    expect(m.order).toEqual(['p1', 'a', 'b', 'c'])
    expect(m.activeId).toBe('p1')
  })

  it('at() addresses pins first, then tabs; negative from the end', () => {
    m.pin('b') // pinned [b], order [a, c]
    expect(m.at(0)).toBe('b')
    expect(m.at(1)).toBe('a')
    expect(m.at(2)).toBe('c')
    expect(m.at(-1)).toBe('c')
    expect(m.at(5)).toBeNull()
  })

  it('at(-1) falls back to the last pin when no regular tabs exist', () => {
    const solo = new TabModel()
    solo.add('x')
    solo.add('y')
    solo.pin('x')
    solo.pin('y')
    expect(solo.at(-1)).toBe('y')
  })

  it('order cycling walks awake pins then tabs, skipping asleep pins', () => {
    m.pin('a') // pinned [a] awake, order [b, c], active c
    m.addPin('p1') // asleep — must be skipped
    expect(m.cycleStep('order', 'forward')).toBe('a') // c wraps to the first awake entry
    expect(m.cycleStep('order', 'forward')).toBe('b')
    m.cycleCommit()
    expect(m.activeId).toBe('b')
  })

  it('MRU cycling includes awake pins and never asleep pins', () => {
    m.pin('b')
    m.addPin('p1')
    expect(m.cycleStep('mru', 'forward')).toBe('b')
    m.cycleCommit()
    expect(m.mru).toEqual(['b', 'c', 'a'])
  })

  it('wake and sleep commit an in-flight cycle first', () => {
    m.addPin('p1')
    m.cycleStep('mru', 'forward') // preview b
    m.wake('p1')
    expect(m.isCycling()).toBe(false)
    expect(m.mru).toEqual(['p1', 'b', 'c', 'a']) // preview b was committed as a visit
    m.cycleStep('mru', 'forward') // preview b
    m.sleep('p1')
    expect(m.isCycling()).toBe(false)
    expect(m.activeId).toBe('b')
  })

  it('activating an asleep pin is a no-op — asleep pins wake via wake()', () => {
    m.addPin('p1')
    m.activate('p1')
    expect(m.activeId).toBe('c')
    expect(m.mru).toEqual(['c', 'b', 'a'])
    expect(m.isAwake('p1')).toBe(false)
  })

  it('wake without activation still commits an in-flight cycle', () => {
    m.addPin('p1')
    m.cycleStep('mru', 'forward') // preview b
    m.wake('p1', false)
    expect(m.isCycling()).toBe(false)
    expect(m.mru).toEqual(['b', 'c', 'a', 'p1']) // preview b committed, p1 joins the tail
    expect(m.activeId).toBe('b')
  })

  it('unpinning an asleep pin lands it at the top of the list, MRU tail', () => {
    m.addPin('p1')
    m.unpin('p1')
    expect(m.pinned).toEqual([])
    expect(m.order).toEqual(['p1', 'a', 'b', 'c'])
    expect(m.mru).toEqual(['c', 'b', 'a', 'p1'])
    expect(m.activeId).toBe('c')
  })

  describe('reorder', () => {
    it('moves a tab toward the end', () => {
      m.reorder('a', 2)
      expect(m.order).toEqual(['b', 'c', 'a'])
    })

    it('moves a tab toward the front', () => {
      m.reorder('c', 0)
      expect(m.order).toEqual(['c', 'a', 'b'])
    })

    it('clamps out-of-range indices', () => {
      m.reorder('a', 99)
      expect(m.order).toEqual(['b', 'c', 'a'])
      m.reorder('a', -5)
      expect(m.order).toEqual(['a', 'b', 'c'])
    })

    it('reorders pins within the pinned list only', () => {
      m.pin('a')
      m.pin('b') // pinned [a, b], order [c]
      m.reorder('b', 0)
      expect(m.pinned).toEqual(['b', 'a'])
      expect(m.order).toEqual(['c'])
    })

    it('does not touch mru or activeId', () => {
      m.reorder('a', 2)
      expect(m.mru).toEqual(['c', 'b', 'a'])
      expect(m.activeId).toBe('c')
    })

    it('ignores unknown ids', () => {
      m.reorder('nope', 1)
      expect(m.order).toEqual(['a', 'b', 'c'])
      expect(m.pinned).toEqual([])
    })
  })
})

describe('TabModel bookmarks', () => {
  let m: TabModel

  beforeEach(() => {
    m = new TabModel()
    m.add('a')
    m.add('b')
    m.add('c') // order [a, b, c], mru [c, b, a], active c
  })

  it('bookmark moves a tab from order to bookmarks and keeps it awake', () => {
    m.bookmark('b')
    expect(m.order).toEqual(['a', 'c'])
    expect(m.bookmarks).toEqual(['b'])
    expect(m.isBookmarkSlot('b')).toBe(true)
    expect(m.isAwake('b')).toBe(true)
    expect(m.mru).toEqual(['c', 'b', 'a'])
  })

  it('bookmark ignores unknown or already-bookmarked ids', () => {
    m.bookmark('b')
    m.bookmark('b')
    m.bookmark('nope')
    expect(m.bookmarks).toEqual(['b'])
    expect(m.order).toEqual(['a', 'c'])
  })

  it('unbookmark returns the slot to the top of the tab list, awake', () => {
    m.bookmark('b')
    m.unbookmark('b')
    expect(m.bookmarks).toEqual([])
    expect(m.order).toEqual(['b', 'a', 'c'])
    expect(m.mru).toEqual(['c', 'b', 'a'])
  })

  it('restored bookmarks start asleep: listed, absent from mru', () => {
    m.addBookmark('bm1')
    expect(m.bookmarks).toEqual(['bm1'])
    expect(m.isAwake('bm1')).toBe(false)
    expect(m.activeId).toBe('c')
  })

  it('wake activates a bookmark slot and promotes it in MRU', () => {
    m.addBookmark('bm1')
    m.wake('bm1')
    expect(m.activeId).toBe('bm1')
    expect(m.mru).toEqual(['bm1', 'c', 'b', 'a'])
  })

  it('sleeping the active bookmark hands off to the MRU front, slot intact', () => {
    m.bookmark('c') // active bookmark
    m.sleep('c')
    expect(m.bookmarks).toEqual(['c'])
    expect(m.mru).toEqual(['b', 'a'])
    expect(m.activeId).toBe('b')
  })

  it('close is a no-op on bookmark slots', () => {
    m.bookmark('b')
    m.close('b')
    expect(m.bookmarks).toEqual(['b'])
    expect(m.mru).toContain('b')
  })

  it('activating an asleep bookmark is a no-op — asleep slots wake via wake()', () => {
    m.addBookmark('bm1')
    m.activate('bm1')
    expect(m.activeId).toBe('c')
    expect(m.isAwake('bm1')).toBe(false)
  })

  it('setBookmarkOrder reorders and drops unknown ids', () => {
    m.addBookmark('x')
    m.addBookmark('y')
    m.setBookmarkOrder(['y', 'x', 'ghost'])
    expect(m.bookmarks).toEqual(['y', 'x'])
  })

  it('removeBookmark drops the slot and hands off the active tab', () => {
    m.bookmark('c') // active bookmark
    m.removeBookmark('c')
    expect(m.bookmarks).toEqual([])
    expect(m.mru).toEqual(['b', 'a'])
    expect(m.activeId).toBe('b')
  })

  it('removeBookmark on an asleep slot just drops it', () => {
    m.addBookmark('bm1')
    m.removeBookmark('bm1')
    expect(m.bookmarks).toEqual([])
    expect(m.activeId).toBe('c')
  })

  it('at() addresses pins, then bookmarks, then tabs', () => {
    m.pin('a') // pinned [a], order [b, c]
    m.bookmark('b') // bookmarks [b], order [c]
    expect(m.at(0)).toBe('a')
    expect(m.at(1)).toBe('b')
    expect(m.at(2)).toBe('c')
    expect(m.at(-1)).toBe('c')
  })

  it('order cycling walks awake pins, awake bookmarks, then tabs', () => {
    m.pin('a') // awake pin
    m.bookmark('b') // awake bookmark
    m.addBookmark('bm1') // asleep — skipped
    // active c: forward wraps to first entry a, then b, then c
    expect(m.cycleStep('order', 'forward')).toBe('a')
    expect(m.cycleStep('order', 'forward')).toBe('b')
    expect(m.cycleStep('order', 'forward')).toBe('c')
  })

  it('MRU cycling includes awake bookmarks and never asleep ones', () => {
    m.bookmark('b')
    m.addBookmark('bm1')
    expect(m.cycleStep('mru', 'forward')).toBe('b')
    m.cycleCommit()
    expect(m.mru).toEqual(['b', 'c', 'a'])
  })
})

describe('TabModel pin/bookmark cross-conversion guards', () => {
  let m: TabModel

  beforeEach(() => {
    m = new TabModel()
    m.add('a')
    m.add('b')
    m.add('c') // order [a, b, c], mru [c, b, a], active c
  })

  it('pin and bookmark return true when converting a normal tab', () => {
    expect(m.pin('a')).toBe(true)
    expect(m.bookmark('b')).toBe(true)
  })

  it('bookmark on a pinned id returns false and changes nothing', () => {
    m.pin('a') // pinned [a], order [b, c]
    const result = m.bookmark('a')
    expect(result).toBe(false)
    expect(m.pinned).toEqual(['a'])
    expect(m.bookmarks).toEqual([])
    expect(m.order).toEqual(['b', 'c'])
    expect(m.mru).toEqual(['c', 'b', 'a'])
  })

  it('pin on a bookmark-slot id returns false and changes nothing', () => {
    m.bookmark('a') // bookmarks [a], order [b, c]
    const result = m.pin('a')
    expect(result).toBe(false)
    expect(m.bookmarks).toEqual(['a'])
    expect(m.pinned).toEqual([])
    expect(m.order).toEqual(['b', 'c'])
    expect(m.mru).toEqual(['c', 'b', 'a'])
  })
})
