import type { TabsSnapshot } from '../shared/ipc'

type DragKind = 'tab' | 'pin'
let drag: { id: string; kind: DragKind } | null = null
let lastOrder: string[] = []
const wiredContainers = new WeakSet<HTMLElement>()

function clearIndicators(): void {
  for (const el of document.querySelectorAll('.drop-before, .drop-after')) {
    el.classList.remove('drop-before', 'drop-after')
  }
}

// vertical lists split rows top/bottom; the pin grid splits buttons left/right
function isBefore(e: DragEvent, el: HTMLElement, vertical: boolean): boolean {
  const r = el.getBoundingClientRect()
  return vertical ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2
}

function wireDrag(el: HTMLElement, id: string, kind: DragKind, index: number, list: string[], vertical: boolean): void {
  el.draggable = true
  el.addEventListener('dragstart', (e) => {
    drag = { id, kind }
    e.dataTransfer?.setData('text/plain', id)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  })
  el.addEventListener('dragend', () => {
    drag = null
    clearIndicators()
  })
  el.addEventListener('dragover', (e) => {
    if (!drag || drag.kind !== kind || drag.id === id) return
    e.preventDefault()
    clearIndicators()
    el.classList.add(isBefore(e, el, vertical) ? 'drop-before' : 'drop-after')
  })
  el.addEventListener('drop', (e) => {
    if (!drag || drag.kind !== kind || drag.id === id) return
    e.preventDefault()
    e.stopPropagation() // the tab-list container would otherwise treat this as an append
    const from = list.indexOf(drag.id)
    let to = index + (isBefore(e, el, vertical) ? 0 : 1)
    if (from < to) to -= 1
    window.synapse.tabs.reorder(drag.id, to)
    drag = null
    clearIndicators()
  })
}

// dropping on empty space below the rows appends to the end of the tab list
function wireListDrop(el: HTMLElement): void {
  if (wiredContainers.has(el)) return
  wiredContainers.add(el)
  el.addEventListener('dragover', (e) => {
    if (drag?.kind === 'tab') e.preventDefault()
  })
  el.addEventListener('drop', (e) => {
    if (drag?.kind !== 'tab') return
    e.preventDefault()
    window.synapse.tabs.reorder(drag.id, lastOrder.length - 1)
    drag = null
    clearIndicators()
  })
}

export function renderPins(el: HTMLElement, snap: TabsSnapshot): void {
  el.innerHTML = ''
  // n ≤ 4 pins each take 1/n of the row; past 4 it's a fixed 4-column grid
  el.style.gridTemplateColumns = `repeat(${Math.min(Math.max(snap.pinned.length, 1), 4)}, 1fr)`
  snap.pinned.forEach((id, i) => {
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
    icon.onerror = () => (icon.style.visibility = 'hidden')
    if (tab.favicon) icon.src = tab.favicon
    else icon.style.visibility = 'hidden'

    btn.append(icon)
    btn.addEventListener('click', () => window.synapse.tabs.activate(id))
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      window.synapse.tabs.showContextMenu(id)
    })
    wireDrag(btn, id, 'pin', i, snap.pinned, false)
    el.append(btn)
  })
}

export function renderTabList(el: HTMLElement, snap: TabsSnapshot): void {
  wireListDrop(el)
  lastOrder = snap.order
  el.innerHTML = ''
  snap.order.forEach((id, i) => {
    const tab = snap.tabs[id]
    const item = document.createElement('div')
    item.className = 'tab' + (id === snap.activeId ? ' active' : '')

    const icon = document.createElement('img')
    icon.className = 'favicon'
    icon.onerror = () => (icon.style.visibility = 'hidden')
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
    wireDrag(item, id, 'tab', i, snap.order, true)
    el.append(item)
  })
}
