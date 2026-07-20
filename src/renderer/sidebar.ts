import type { TabsSnapshot } from '../shared/ipc'
import { wireDragItem, wireDropZone } from './drag-list'
import { rowIcon } from './row-icon'

// the tab-list container is wired once but order changes every render
let lastOrder: string[] = []

// double-click rename (tab or group): while an editor is up, snapshots keep
// arriving (loading flicker, page titles) and a repaint would destroy the
// input mid-typing — hold the latest one and apply it when the edit ends
let renaming: string | null = null
let pendingSnap: TabsSnapshot | null = null

// tab groups: collapse is presentation-only state, like bookmark folders'.
// editingGroup renders that group's header as an inline rename editor.
const collapsedGroups = new Set<string>()
let editingGroup: string | null = null
let lastEl: HTMLElement | null = null
let lastSnap: TabsSnapshot | null = null

// multi-select (issue #37): ⌘-click toggles, ⇧-click ranges from the anchor.
// Presentation-only state like collapse — a plain click clears it, and ids
// that leave the tab list are pruned each render.
const selectedTabs = new Set<string>()
let selectionAnchor: string | null = null

// open a group's rename editor (＋ Group button, context-menu Rename); the
// editor appears on this render if the group is known, else when its
// snapshot arrives
export function startGroupEdit(groupId: string): void {
  editingGroup = groupId
  if (lastEl && lastSnap) renderTabList(lastEl, lastSnap)
}

export function renderPins(el: HTMLElement, snap: TabsSnapshot): void {
  el.innerHTML = ''
  // n ≤ 4 pins each take 1/n of the row; past 4 it's a fixed 4-column grid
  el.style.gridTemplateColumns = `repeat(${Math.min(Math.max(snap.pinned.length, 1), 4)}, 1fr)`
  snap.pinned.forEach((id, i) => {
    const tab = snap.tabs[id]!
    const btn = document.createElement('button')
    btn.className =
      'pin' +
      (id === snap.activeId ? ' active' : '') +
      (tab.isAsleep ? ' asleep' : '') +
      (tab.profile === 'work' ? ' work' : '') +
      (snap.panes.includes(id) ? ' in-split' : '')
    btn.title = tab.title

    const icon = document.createElement('img')
    icon.className = 'favicon'
    icon.onerror = () => (icon.style.visibility = 'hidden')
    if (tab.favicon) icon.src = tab.favicon
    else icon.style.visibility = 'hidden'

    btn.append(icon)
    btn.addEventListener('click', (e) => {
      // ⌘-click tiles the pin next to the current pane instead of switching
      if (e.metaKey || e.ctrlKey) window.synapse.tabs.openInSplit(id)
      else window.synapse.tabs.activate(id)
    })
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      window.synapse.tabs.showContextMenu(id)
    })
    wireDragItem(btn, { kind: 'pin', id }, {
      vertical: false,
      accepts: (d) => d.kind === 'pin',
      onDrop: (d, before) => {
        const from = snap.pinned.indexOf(d.id)
        let to = i + (before ? 0 : 1)
        if (from !== -1 && from < to) to -= 1
        window.synapse.tabs.reorder(d.id, to)
      },
    })
    el.append(btn)
  })
}

// insertion index into snap.order after the dragged tab is removed
function adjustedIndex(snap: TabsSnapshot, draggedId: string, to: number): number {
  const from = snap.order.indexOf(draggedId)
  return from !== -1 && from < to ? to - 1 : to
}

// move a whole group block before/after an anchor tab's position; indices
// are in order-minus-members terms (what the model splices against)
function moveGroupNextTo(snap: TabsSnapshot, groupId: string, anchorTab: string, before: boolean): void {
  const rest = snap.order.filter((t) => snap.tabGroups[t] !== groupId)
  const i = rest.indexOf(anchorTab)
  if (i === -1) return
  window.synapse.groups.reorder(groupId, i + (before ? 0 : 1))
}

// dragging a tab onto the middle band of another tab groups them; the outer
// bands keep plain reordering
function middleBand(e: DragEvent, el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  const frac = (e.clientY - r.top) / r.height
  return frac > 0.3 && frac < 0.7
}

export function renderTabList(el: HTMLElement, snap: TabsSnapshot): void {
  if (renaming) {
    pendingSnap = snap
    return
  }
  lastEl = el
  lastSnap = snap
  // a group that vanished (closed, saved to bookmarks) drops its local state
  if (editingGroup && !snap.groups[editingGroup]) editingGroup = null
  for (const gid of [...collapsedGroups]) if (!snap.groups[gid]) collapsedGroups.delete(gid)
  for (const id of [...selectedTabs]) if (!snap.order.includes(id)) selectedTabs.delete(id)
  if (selectionAnchor && !snap.order.includes(selectionAnchor)) selectionAnchor = null
  wireDropZone(el, {
    accepts: (d) => d.kind === 'tab' || d.kind === 'group',
    onDrop: (d) => {
      // empty space below the rows: tabs go to the end, ungrouped; group
      // blocks move to the end wholesale
      if (d.kind === 'group') window.synapse.groups.reorder(d.id, lastOrder.length)
      else window.synapse.tabs.reorder(d.id, lastOrder.length - 1, null)
    },
  })
  lastOrder = snap.order
  el.innerHTML = ''
  let prevGroup: string | null = null
  snap.order.forEach((id, i) => {
    const tab = snap.tabs[id]!
    const gid = snap.tabGroups[id] ?? null
    if (gid && gid !== prevGroup) el.append(groupHeader(el, snap, gid, i))
    prevGroup = gid
    if (gid && collapsedGroups.has(gid)) return
    const groupColor = gid ? snap.groups[gid]?.color : undefined
    const item = document.createElement('div')
    item.className =
      'tab' +
      (gid ? ' grouped' : '') +
      (groupColor ? ` colored gc-${groupColor}` : '') +
      (selectedTabs.has(id) ? ' selected' : '') +
      (tab.isAsleep ? ' asleep' : '') +
      (id === snap.activeId ? ' active' : '') +
      (tab.profile === 'work' ? ' work' : '') +
      (snap.panes.includes(id) ? ' in-split' : '')

    const icon = rowIcon(tab.favicon, tab.isLoading, tab.profile === 'work')

    const title = document.createElement('span')
    title.className = 'tab-title'
    title.textContent = tab.title

    const close = document.createElement('button')
    close.className = 'tab-close'
    close.textContent = '×'
    close.title = 'Close tab'
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      window.synapse.tabs.close(id)
    })

    item.append(icon, title, close)
    item.addEventListener('click', (e) => {
      // ⌘-click toggles selection, ⇧-click selects the anchor→here range
      // (issue #37); ⌥-click keeps the old split-tiling gesture
      if (e.metaKey || e.ctrlKey) {
        if (selectedTabs.has(id)) selectedTabs.delete(id)
        else selectedTabs.add(id)
        selectionAnchor = id
        renderTabList(el, snap)
        return
      }
      if (e.shiftKey) {
        const from = selectionAnchor ?? snap.activeId ?? id
        const a = snap.order.indexOf(from)
        const b = snap.order.indexOf(id)
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        selectedTabs.clear()
        for (const t of snap.order.slice(Math.max(lo, 0), hi + 1)) selectedTabs.add(t)
        selectionAnchor = from
        renderTabList(el, snap)
        return
      }
      if (e.altKey) {
        window.synapse.tabs.openInSplit(id)
        return
      }
      // repaint now — activating the already-active tab emits no snapshot,
      // which would leave stale .selected highlights behind
      if (selectedTabs.size > 0) {
        selectedTabs.clear()
        selectionAnchor = null
        renderTabList(el, snap)
      }
      window.synapse.tabs.activate(id)
    })
    item.addEventListener('dblclick', () => startTabRename(el, snap, item, title, id))
    // middle click doesn't fire 'click' in browsers; it's reported via auxclick
    item.addEventListener('auxclick', (e) => {
      if (e.button === 1) window.synapse.tabs.close(id)
    })
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      // right-clicking inside the selection acts on all of it; outside, on
      // this row alone
      window.synapse.tabs.showContextMenu(
        id,
        selectedTabs.has(id) && selectedTabs.size > 1 ? [...selectedTabs] : undefined,
      )
    })
    wireDragItem(item, { kind: 'tab', id }, {
      accepts: (d) => d.kind === 'tab' || (d.kind === 'group' && d.id !== gid),
      // a tab hovering this row's middle band will group with it
      into: (d, e, elm) => d.kind === 'tab' && middleBand(e, elm),
      onDrop: (d, before, into) => {
        if (d.kind === 'group') {
          moveGroupNextTo(snap, d.id, id, before)
          return
        }
        if (into) {
          // onto a grouped tab: join right behind it; onto a loose tab:
          // found a new group around the pair
          if (gid) window.synapse.tabs.reorder(d.id, adjustedIndex(snap, d.id, i + 1), gid)
          else window.synapse.groups.createFromDrop(id, d.id)
          return
        }
        // edges reorder; the destination membership follows this row's group
        window.synapse.tabs.reorder(d.id, adjustedIndex(snap, d.id, i + (before ? 0 : 1)), gid)
      },
      // released past the window edge: tear the tab into its own window
      onDragOut: (e) => window.synapse.tabs.detach(id, e.screenX, e.screenY),
    })
    el.append(item)
  })
}

function groupHeader(
  el: HTMLElement,
  snap: TabsSnapshot,
  gid: string,
  firstIndex: number,
): HTMLDivElement {
  const group = snap.groups[gid]!
  const members = snap.order.filter((t) => snap.tabGroups[t] === gid)
  if (editingGroup === gid) return groupEditor(el, snap, gid)
  const row = document.createElement('div')
  const collapsed = collapsedGroups.has(gid)
  row.className =
    'panel-item folder group-header' +
    (group.profile === 'work' ? ' work' : '') +
    (group.color ? ` colored gc-${group.color}` : '') +
    // a collapsed group hides its rows; carry the hidden active tab's
    // highlight on the header so focus never disappears from the sidebar
    (collapsed && snap.activeId && members.includes(snap.activeId) ? ' active' : '')

  const twist = document.createElement('span')
  twist.className = 'folder-twist'
  twist.textContent = collapsed ? '▸' : '▾'
  const name = document.createElement('span')
  name.className = 'folder-name'
  name.textContent = group.name
  const count = document.createElement('span')
  count.className = 'folder-count'
  count.textContent = String(members.length)
  if (group.profile === 'work') count.title = 'Work profile'

  const close = document.createElement('button')
  close.className = 'tab-close'
  close.textContent = '×'
  close.title = 'Close group'
  close.addEventListener('click', (e) => {
    e.stopPropagation()
    window.synapse.groups.close(gid)
  })

  row.append(twist, name, count, close)
  row.addEventListener('click', () => {
    if (collapsedGroups.has(gid)) collapsedGroups.delete(gid)
    else collapsedGroups.add(gid)
    renderTabList(el, snap)
  })
  row.addEventListener('dblclick', () => {
    editingGroup = gid
    renderTabList(el, snap)
  })
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    window.synapse.groups.showContextMenu(gid)
  })
  wireDragItem(row, { kind: 'group', id: gid }, {
    accepts: (d) => d.kind === 'tab' || (d.kind === 'group' && d.id !== gid),
    into: (d) => d.kind === 'tab',
    onDrop: (d, before, into) => {
      if (into && d.kind === 'tab') {
        collapsedGroups.delete(gid) // auto-expand so the drop is visible
        window.synapse.tabs.reorder(d.id, adjustedIndex(snap, d.id, firstIndex), gid)
        return
      }
      // group onto group header: whole-block reorder around this block
      const anchor = before ? members[0] : members[members.length - 1]
      if (anchor) moveGroupNextTo(snap, d.id, anchor, before)
    },
  })
  return row
}

function groupEditor(el: HTMLElement, snap: TabsSnapshot, gid: string): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'panel-item folder group-header'
  const input = document.createElement('input')
  input.className = 'folder-input'
  input.value = snap.groups[gid]!.name
  renaming = gid
  let done = false
  const finish = (commit: boolean): void => {
    if (done) return
    done = true
    renaming = null
    editingGroup = null
    if (commit && input.value.trim()) window.synapse.groups.rename(gid, input.value.trim())
    const next = pendingSnap ?? snap
    pendingSnap = null
    renderTabList(el, next)
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true)
    else if (e.key === 'Escape') finish(false)
    e.stopPropagation()
  })
  // clicking away saves (Esc is the cancel gesture)
  input.addEventListener('blur', () => finish(true))
  input.addEventListener('click', (e) => e.stopPropagation())
  input.addEventListener('dblclick', (e) => e.stopPropagation())
  row.append(input)
  queueMicrotask(() => {
    input.focus()
    input.select() // preselect the old name so typing replaces it
  })
  return row
}

// swap the row's title span for an input in place; Enter/blur commit,
// Esc cancels, an empty commit reverts the tab to its page title
function startTabRename(
  el: HTMLElement,
  snap: TabsSnapshot,
  item: HTMLDivElement,
  title: HTMLSpanElement,
  id: string,
): void {
  if (renaming) return
  renaming = id
  item.draggable = false // a mouse text-selection must not start a row drag
  const input = document.createElement('input')
  input.className = 'folder-input'
  input.value = title.textContent ?? ''
  let done = false
  const finish = (commit: boolean): void => {
    if (done) return
    done = true
    renaming = null
    if (commit) window.synapse.tabs.rename(id, input.value.trim())
    // repaint immediately so the editor never lingers; the rename's own
    // snapshot push then paints the committed title
    const next = pendingSnap ?? snap
    pendingSnap = null
    renderTabList(el, next)
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true)
    else if (e.key === 'Escape') finish(false)
    e.stopPropagation()
  })
  input.addEventListener('blur', () => finish(true))
  // clicks in the input must not activate the tab or restart the editor
  input.addEventListener('click', (e) => e.stopPropagation())
  input.addEventListener('dblclick', (e) => e.stopPropagation())
  title.replaceWith(input)
  queueMicrotask(() => {
    input.focus()
    input.select() // preselect the old name so typing replaces it
  })
}
