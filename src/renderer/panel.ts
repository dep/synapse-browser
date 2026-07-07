export type PanelMode = 'none' | 'history' | 'bookmarks'

export async function renderPanel(el: HTMLElement, mode: PanelMode): Promise<void> {
  el.innerHTML = ''
  if (mode === 'none') return

  const heading = document.createElement('div')
  heading.className = 'panel-heading'
  heading.textContent = mode === 'history' ? 'History' : 'Bookmarks'
  el.append(heading)

  const items =
    mode === 'history'
      ? await window.synapse.history.list()
      : (await window.synapse.bookmarks.list()).bookmarks

  if (items.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'panel-empty'
    empty.textContent = mode === 'history' ? 'No history yet' : 'No bookmarks yet'
    el.append(empty)
    return
  }

  for (const item of items) {
    const row = document.createElement('div')
    row.className = 'panel-item'
    const title = document.createElement('span')
    title.className = 'panel-item-title'
    title.textContent = item.title || item.url
    const url = document.createElement('span')
    url.className = 'panel-item-url'
    url.textContent = item.url
    row.append(title, url)
    row.addEventListener('click', () =>
      'id' in item ? window.synapse.bookmarks.open(item.id) : window.synapse.tabs.create(item.url),
    )
    el.append(row)
  }
}
