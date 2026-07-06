import type { TabsSnapshot } from '../shared/ipc'

export function renderPins(el: HTMLElement, snap: TabsSnapshot): void {
  el.innerHTML = ''
  // n ≤ 4 pins each take 1/n of the row; past 4 it's a fixed 4-column grid
  el.style.gridTemplateColumns = `repeat(${Math.min(Math.max(snap.pinned.length, 1), 4)}, 1fr)`
  for (const id of snap.pinned) {
    const tab = snap.tabs[id]
    const btn = document.createElement('button')
    btn.className =
      'pin' +
      (id === snap.activeId ? ' active' : '') +
      (tab.isAsleep ? ' asleep' : '') +
      (tab.profile === 'work' ? ' work' : '')
    btn.title = tab.title

    const icon = document.createElement('img')
    icon.className = 'favicon'
    if (tab.favicon) icon.src = tab.favicon
    else icon.style.visibility = 'hidden'

    btn.append(icon)
    btn.addEventListener('click', () => window.synapse.tabs.activate(id))
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      window.synapse.tabs.showContextMenu(id)
    })
    el.append(btn)
  }
}

export function renderTabList(el: HTMLElement, snap: TabsSnapshot): void {
  el.innerHTML = ''
  for (const id of snap.order) {
    const tab = snap.tabs[id]
    const item = document.createElement('div')
    item.className = 'tab' + (id === snap.activeId ? ' active' : '')

    const icon = document.createElement('img')
    icon.className = 'favicon'
    if (tab.favicon) icon.src = tab.favicon
    else icon.style.visibility = 'hidden'

    const title = document.createElement('span')
    title.className = 'tab-title'
    title.textContent = tab.title
    if (tab.isLoading) title.textContent = `… ${tab.title}`

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
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      window.synapse.tabs.showContextMenu(id)
    })
    el.append(item)
  }
}
