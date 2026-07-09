import type { TabsSnapshot } from '../shared/ipc'
import { wireDragItem, wireDropZone } from './drag-list'
import { loadSpinner } from './load-spinner'

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
      (tab.profile === 'work' ? ' work' : '')
    btn.title = tab.title

    const icon = document.createElement('img')
    icon.className = 'favicon'
    icon.onerror = () => (icon.style.visibility = 'hidden')
    if (tab.favicon) icon.src = tab.favicon
    else icon.style.visibility = 'hidden'

    btn.append(icon)
    btn.addEventListener('click', () => window.synapse.tabs.activate(id))
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
    item.className = 'tab' + (id === snap.activeId ? ' active' : '')

    let icon: HTMLElement
    if (tab.isLoading) {
      icon = loadSpinner()
    } else {
      const img = document.createElement('img')
      img.className = 'favicon'
      img.onerror = () => (img.style.visibility = 'hidden')
      if (tab.favicon) img.src = tab.favicon
      else img.style.visibility = 'hidden'
      icon = img
    }

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

    if (tab.profile === 'work') {
      const dot = document.createElement('span')
      dot.className = 'profile-dot'
      dot.title = 'Work profile'
      item.append(icon, title, dot, close)
    } else {
      item.append(icon, title, close)
    }
    item.addEventListener('click', () => window.synapse.tabs.activate(id))
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
    })
    el.append(item)
  })
}
