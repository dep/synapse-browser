export type PanelMode = 'none' | 'history'

export async function renderPanel(el: HTMLElement, mode: PanelMode): Promise<void> {
  el.innerHTML = ''
  if (mode === 'none') return
  const heading = document.createElement('div')
  heading.className = 'panel-heading'
  heading.textContent = 'History'
  el.append(heading)
  const items = await window.synapse.history.list()
  if (items.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'panel-empty'
    empty.textContent = 'No history yet'
    el.append(empty)
    return
  }
  for (const item of items) {
    const row = document.createElement('div')
    row.className = 'panel-item'
    const titleEl = document.createElement('span')
    titleEl.className = 'panel-item-title'
    titleEl.textContent = item.title || item.url
    const urlEl = document.createElement('span')
    urlEl.className = 'panel-item-url'
    urlEl.textContent = item.url
    row.append(titleEl, urlEl)
    row.addEventListener('click', () => window.synapse.tabs.create(item.url))
    el.append(row)
  }
}
