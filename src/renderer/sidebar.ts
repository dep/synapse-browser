import type { TabsSnapshot } from '../shared/ipc'
import { wireDragItem, wireDropZone } from './drag-list'
import { rowIcon } from './row-icon'

// the tab-list container is wired once but order changes every render
let lastOrder: string[] = []

// double-click rename: while an editor is up, snapshots keep arriving
// (loading flicker, page titles) and a repaint would destroy the input
// mid-typing — hold the latest one and apply it when the edit ends
let renaming: string | null = null
let pendingSnap: TabsSnapshot | null = null

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

export function renderTabList(el: HTMLElement, snap: TabsSnapshot): void {
  if (renaming) {
    pendingSnap = snap
    return
  }
  wireDropZone(el, {
    accepts: (d) => d.kind === 'tab',
    onDrop: (d) => window.synapse.tabs.reorder(d.id, lastOrder.length - 1),
  })
  lastOrder = snap.order
  el.innerHTML = ''
  snap.order.forEach((id, i) => {
    const tab = snap.tabs[id]!
    const item = document.createElement('div')
    item.className =
      'tab' +
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
      // ⌘-click tiles the tab next to the current pane instead of switching
      if (e.metaKey || e.ctrlKey) window.synapse.tabs.openInSplit(id)
      else window.synapse.tabs.activate(id)
    })
    item.addEventListener('dblclick', () => startTabRename(el, snap, item, title, id))
    // middle click doesn't fire 'click' in browsers; it's reported via auxclick
    item.addEventListener('auxclick', (e) => {
      if (e.button === 1) window.synapse.tabs.close(id)
    })
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      window.synapse.tabs.showContextMenu(id)
    })
    wireDragItem(item, { kind: 'tab', id }, {
      accepts: (d) => d.kind === 'tab',
      onDrop: (d, before) => {
        const from = snap.order.indexOf(d.id)
        let to = i + (before ? 0 : 1)
        if (from !== -1 && from < to) to -= 1
        window.synapse.tabs.reorder(d.id, to)
      },
      // released past the window edge: tear the tab into its own window
      onDragOut: (e) => window.synapse.tabs.detach(id, e.screenX, e.screenY),
    })
    el.append(item)
  })
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
