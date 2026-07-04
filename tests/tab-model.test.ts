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

  it('closing the active tab activates the MRU front', () => {
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
