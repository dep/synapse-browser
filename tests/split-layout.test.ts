import { describe, expect, it } from 'vitest'
import {
  computePaneRects,
  hasLeaf,
  leafIds,
  removeLeaf,
  replaceLeaf,
  showsSplit,
  splitLeaf,
  type SplitNode,
} from '../src/shared/split-layout'

const leaf = (id: string): SplitNode => ({ leaf: id })

describe('splitLeaf', () => {
  it('splits a root leaf into a row with anchor first, new pane second', () => {
    const root = splitLeaf(leaf('a'), 'a', 'b', 'row')
    expect(root).toEqual({ dir: 'row', children: [leaf('a'), leaf('b')] })
  })

  it('splits a root leaf into a col for horizontal splits', () => {
    const root = splitLeaf(leaf('a'), 'a', 'b', 'col')
    expect(root).toEqual({ dir: 'col', children: [leaf('a'), leaf('b')] })
  })

  it('splitting in the parent direction inserts a sibling right after the anchor', () => {
    const root: SplitNode = { dir: 'row', children: [leaf('a'), leaf('b')] }
    expect(splitLeaf(root, 'a', 'c', 'row')).toEqual({
      dir: 'row',
      children: [leaf('a'), leaf('c'), leaf('b')],
    })
  })

  it('splitting across the parent direction wraps the anchor leaf in a nested split', () => {
    const root: SplitNode = { dir: 'row', children: [leaf('a'), leaf('b')] }
    expect(splitLeaf(root, 'b', 'c', 'col')).toEqual({
      dir: 'row',
      children: [leaf('a'), { dir: 'col', children: [leaf('b'), leaf('c')] }],
    })
  })

  it('finds the anchor inside nested splits', () => {
    const root: SplitNode = {
      dir: 'row',
      children: [{ dir: 'col', children: [leaf('a'), leaf('b')] }, leaf('c')],
    }
    expect(splitLeaf(root, 'b', 'd', 'col')).toEqual({
      dir: 'row',
      children: [{ dir: 'col', children: [leaf('a'), leaf('b'), leaf('d')] }, leaf('c')],
    })
  })

  it('returns the tree unchanged when the anchor is unknown', () => {
    const root: SplitNode = { dir: 'row', children: [leaf('a'), leaf('b')] }
    expect(splitLeaf(root, 'zzz', 'c', 'row')).toBe(root)
  })
})

describe('removeLeaf', () => {
  it('removing one of two panes collapses back to a single leaf', () => {
    const root: SplitNode = { dir: 'row', children: [leaf('a'), leaf('b')] }
    expect(removeLeaf(root, 'b')).toEqual(leaf('a'))
  })

  it('removing the last leaf yields null', () => {
    expect(removeLeaf(leaf('a'), 'a')).toBeNull()
  })

  it('removing a nested leaf collapses its single-child parent into the grandparent', () => {
    const root: SplitNode = {
      dir: 'row',
      children: [leaf('a'), { dir: 'col', children: [leaf('b'), leaf('c')] }],
    }
    expect(removeLeaf(root, 'c')).toEqual({ dir: 'row', children: [leaf('a'), leaf('b')] })
  })

  it('keeps a 3-way split as a 2-way split', () => {
    const root: SplitNode = { dir: 'row', children: [leaf('a'), leaf('b'), leaf('c')] }
    expect(removeLeaf(root, 'b')).toEqual({ dir: 'row', children: [leaf('a'), leaf('c')] })
  })

  it('returns the tree unchanged when the id is unknown', () => {
    const root: SplitNode = { dir: 'row', children: [leaf('a'), leaf('b')] }
    expect(removeLeaf(root, 'zzz')).toBe(root)
  })
})

describe('replaceLeaf', () => {
  it('swaps a leaf id in place, keeping the tree shape', () => {
    const root: SplitNode = {
      dir: 'row',
      children: [{ dir: 'col', children: [leaf('a'), leaf('b')] }, leaf('c')],
    }
    expect(replaceLeaf(root, 'b', 'x')).toEqual({
      dir: 'row',
      children: [{ dir: 'col', children: [leaf('a'), leaf('x')] }, leaf('c')],
    })
  })

  it('returns the tree unchanged when the target is unknown', () => {
    const root: SplitNode = { dir: 'row', children: [leaf('a'), leaf('b')] }
    expect(replaceLeaf(root, 'zzz', 'x')).toBe(root)
  })
})

describe('leafIds / hasLeaf', () => {
  it('lists leaves depth-first, left to right', () => {
    const root: SplitNode = {
      dir: 'row',
      children: [{ dir: 'col', children: [leaf('a'), leaf('b')] }, leaf('c')],
    }
    expect(leafIds(root)).toEqual(['a', 'b', 'c'])
  })

  it('a single leaf lists itself', () => {
    expect(leafIds(leaf('a'))).toEqual(['a'])
  })

  it('hasLeaf finds nested leaves and rejects unknowns', () => {
    const root: SplitNode = {
      dir: 'row',
      children: [{ dir: 'col', children: [leaf('a'), leaf('b')] }, leaf('c')],
    }
    expect(hasLeaf(root, 'b')).toBe(true)
    expect(hasLeaf(root, 'z')).toBe(false)
  })
})

describe('showsSplit', () => {
  const root: SplitNode = { dir: 'row', children: [leaf('a'), leaf('b')] }

  it('shows the tiling only while the active tab is one of its panes', () => {
    expect(showsSplit(root, 'a')).toBe(true)
    expect(showsSplit(root, 'b')).toBe(true)
  })

  it('an outside active tab hides the tiling (it displays full-canvas instead)', () => {
    expect(showsSplit(root, 'outside')).toBe(false)
  })

  it('no split or no active tab shows nothing', () => {
    expect(showsSplit(null, 'a')).toBe(false)
    expect(showsSplit(root, null)).toBe(false)
  })
})

describe('computePaneRects', () => {
  const bounds = { x: 100, y: 50, width: 800, height: 600 }

  it('a single leaf fills the whole bounds', () => {
    expect(computePaneRects(leaf('a'), bounds, 8)).toEqual([{ id: 'a', rect: bounds }])
  })

  it('a row of two shares the width equally with one gap between', () => {
    const root: SplitNode = { dir: 'row', children: [leaf('a'), leaf('b')] }
    const rects = computePaneRects(root, bounds, 8)
    expect(rects).toEqual([
      { id: 'a', rect: { x: 100, y: 50, width: 396, height: 600 } },
      { id: 'b', rect: { x: 504, y: 50, width: 396, height: 600 } },
    ])
  })

  it('a col of two shares the height equally with one gap between', () => {
    const root: SplitNode = { dir: 'col', children: [leaf('a'), leaf('b')] }
    const rects = computePaneRects(root, bounds, 8)
    expect(rects).toEqual([
      { id: 'a', rect: { x: 100, y: 50, width: 800, height: 296 } },
      { id: 'b', rect: { x: 100, y: 354, width: 800, height: 296 } },
    ])
  })

  it('three-way rows cover the full span exactly despite rounding', () => {
    const root: SplitNode = { dir: 'row', children: [leaf('a'), leaf('b'), leaf('c')] }
    const rects = computePaneRects(root, { x: 0, y: 0, width: 1000, height: 100 }, 8)
    expect(rects.map((r) => r.rect.x)).toEqual([0, 336, 672])
    // each pane starts one gap after the previous ends, and the last ends flush
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i]!.rect.x).toBe(rects[i - 1]!.rect.x + rects[i - 1]!.rect.width + 8)
    }
    const last = rects[rects.length - 1]!.rect
    expect(last.x + last.width).toBe(1000)
    expect(rects.every((r) => r.rect.height === 100)).toBe(true)
  })

  it('nested splits subdivide their parent cell', () => {
    const root: SplitNode = {
      dir: 'row',
      children: [{ dir: 'col', children: [leaf('a'), leaf('b')] }, leaf('c')],
    }
    const rects = computePaneRects(root, { x: 0, y: 0, width: 808, height: 608 }, 8)
    expect(rects).toEqual([
      { id: 'a', rect: { x: 0, y: 0, width: 400, height: 300 } },
      { id: 'b', rect: { x: 0, y: 308, width: 400, height: 300 } },
      { id: 'c', rect: { x: 408, y: 0, width: 400, height: 608 } },
    ])
  })

  it('never produces negative sizes when bounds are too small', () => {
    const root: SplitNode = { dir: 'row', children: [leaf('a'), leaf('b'), leaf('c')] }
    const rects = computePaneRects(root, { x: 0, y: 0, width: 10, height: 10 }, 8)
    for (const { rect } of rects) {
      expect(rect.width).toBeGreaterThanOrEqual(0)
      expect(rect.height).toBeGreaterThanOrEqual(0)
    }
  })
})
