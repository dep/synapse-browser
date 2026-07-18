// Pure split-pane tree shared by main (positions pane views) and tests.
// A window's split state is a tree: leaves are tab ids, inner nodes divide
// their cell among children along one axis. Splitting along the parent's
// axis inserts a sibling (n-ary, no depth explosion); splitting across
// wraps the leaf in a nested node — that's what makes free-form tiling
// (two stacked panes left, one tall pane right) fall out naturally.

export type SplitDir = 'row' | 'col' // row = panes side by side, col = stacked

export type SplitNode = { leaf: string } | { dir: SplitDir; children: SplitNode[] }

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface PaneRect {
  id: string
  rect: Rect
}

function isLeaf(n: SplitNode): n is { leaf: string } {
  return 'leaf' in n
}

export function leafIds(node: SplitNode): string[] {
  return isLeaf(node) ? [node.leaf] : node.children.flatMap(leafIds)
}

export function hasLeaf(node: SplitNode, id: string): boolean {
  return isLeaf(node) ? node.leaf === id : node.children.some((c) => hasLeaf(c, id))
}

// Insert `newId` next to the `anchor` leaf, dividing along `dir`. Returns a
// new tree (input untouched); the same tree when the anchor isn't present.
export function splitLeaf(
  root: SplitNode,
  anchor: string,
  newId: string,
  dir: SplitDir,
): SplitNode {
  if (isLeaf(root)) {
    if (root.leaf !== anchor) return root
    return { dir, children: [root, { leaf: newId }] }
  }
  const at = root.children.findIndex((c) => isLeaf(c) && c.leaf === anchor)
  if (at !== -1) {
    const children = [...root.children]
    if (root.dir === dir) children.splice(at + 1, 0, { leaf: newId })
    else children[at] = { dir, children: [children[at]!, { leaf: newId }] }
    return { dir: root.dir, children }
  }
  let changed = false
  const children = root.children.map((c) => {
    const next = splitLeaf(c, anchor, newId, dir)
    if (next !== c) changed = true
    return next
  })
  return changed ? { dir: root.dir, children } : root
}

// The tiling displays only while the active tab is one of its panes; an
// outside activation (sidebar click, Cmd+T, urlbar Alt+Enter) shows that tab
// full-canvas and the split waits in the background until a pane tab is
// active again.
export function showsSplit(root: SplitNode | null, activeId: string | null): boolean {
  return root !== null && activeId !== null && hasLeaf(root, activeId)
}

// Swap a leaf's tab in place, keeping the tree shape. Same tree when the
// target isn't present.
export function replaceLeaf(root: SplitNode, target: string, newId: string): SplitNode {
  if (isLeaf(root)) return root.leaf === target ? { leaf: newId } : root
  let changed = false
  const children = root.children.map((c) => {
    const next = replaceLeaf(c, target, newId)
    if (next !== c) changed = true
    return next
  })
  return changed ? { dir: root.dir, children } : root
}

// Remove a leaf; single-child nodes collapse into their child so the tree
// never carries degenerate splits. Null when the last leaf goes.
export function removeLeaf(root: SplitNode, id: string): SplitNode | null {
  if (isLeaf(root)) return root.leaf === id ? null : root
  if (!hasLeaf(root, id)) return root
  const children = root.children
    .map((c) => removeLeaf(c, id))
    .filter((c): c is SplitNode => c !== null)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]!
  return { dir: root.dir, children }
}

// Equal division along each node's axis with `gap` px between siblings.
// Boundaries come from rounding cumulative positions so children always
// tile the parent exactly (no drift on odd sizes).
export function computePaneRects(root: SplitNode, bounds: Rect, gap: number): PaneRect[] {
  if (isLeaf(root)) return [{ id: root.leaf, rect: bounds }]
  const out: PaneRect[] = []
  const n = root.children.length
  const horizontal = root.dir === 'row'
  const span = Math.max(0, (horizontal ? bounds.width : bounds.height) - gap * (n - 1))
  let cursor = horizontal ? bounds.x : bounds.y
  for (let i = 0; i < n; i++) {
    const end =
      (horizontal ? bounds.x : bounds.y) + Math.round((span * (i + 1)) / n) + gap * i
    const size = Math.max(0, end - cursor)
    const cell: Rect = horizontal
      ? { x: cursor, y: bounds.y, width: size, height: bounds.height }
      : { x: bounds.x, y: cursor, width: bounds.width, height: size }
    out.push(...computePaneRects(root.children[i]!, cell, gap))
    cursor = end + gap
  }
  return out
}
