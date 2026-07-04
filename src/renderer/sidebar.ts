import type { TabsSnapshot } from '../shared/ipc'

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

    item.append(icon, title, close)
    item.addEventListener('click', () => window.synapse.tabs.activate(id))
    el.append(item)
  }
}
