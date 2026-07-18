import type { TabsSnapshot } from '../shared/ipc'
import { wireDragItem, wireDropZone } from './drag-list'
import { rowIcon } from './row-icon'

// the tab-list container is wired once but order changes every render
let lastOrder: string[] = []

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
