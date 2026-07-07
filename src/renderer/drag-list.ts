// Shared HTML5 drag-and-drop helper for the sidebar lists and the bookmarks
// panel. One drag runs at a time; `accepts` decides which targets react.
export interface DragItem {
  kind: string
  id: string
}

let drag: DragItem | null = null
const wiredZones = new WeakSet<HTMLElement>()

export function clearIndicators(): void {
  for (const el of document.querySelectorAll('.drop-before, .drop-after, .drop-into')) {
    el.classList.remove('drop-before', 'drop-after', 'drop-into')
  }
}

// vertical lists split rows top/bottom; horizontal (pin grid) splits left/right
function isBefore(e: DragEvent, el: HTMLElement, vertical: boolean): boolean {
  const r = el.getBoundingClientRect()
  return vertical ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2
}

export interface DragItemOpts {
  vertical?: boolean // default true
  accepts(drag: DragItem): boolean
  // when true for a drag, it drops INTO this element (e.g. a folder row)
  // instead of before/after it
  into?(drag: DragItem): boolean
  onDrop(drag: DragItem, before: boolean): void
}

export function wireDragItem(el: HTMLElement, self: DragItem, opts: DragItemOpts): void {
  el.draggable = true
  el.addEventListener('dragstart', (e) => {
    drag = self
    e.dataTransfer?.setData('text/plain', self.id)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  })
  el.addEventListener('dragend', () => {
    drag = null
    clearIndicators()
  })
  el.addEventListener('dragover', (e) => {
    if (!drag || drag.id === self.id || !opts.accepts(drag)) return
    e.preventDefault()
    clearIndicators()
    if (opts.into?.(drag)) el.classList.add('drop-into')
    else el.classList.add(isBefore(e, el, opts.vertical ?? true) ? 'drop-before' : 'drop-after')
  })
  el.addEventListener('drop', (e) => {
    if (!drag || drag.id === self.id || !opts.accepts(drag)) return
    e.preventDefault()
    e.stopPropagation() // containers would otherwise treat this as an append
    opts.onDrop(drag, opts.into?.(drag) ? false : isBefore(e, el, opts.vertical ?? true))
    drag = null
    clearIndicators()
  })
}

// dropping on a container's empty space (below the rows) appends
export function wireDropZone(
  el: HTMLElement,
  opts: { accepts(drag: DragItem): boolean; onDrop(drag: DragItem): void },
): void {
  if (wiredZones.has(el)) return
  wiredZones.add(el)
  el.addEventListener('dragover', (e) => {
    if (drag && opts.accepts(drag)) e.preventDefault()
  })
  el.addEventListener('drop', (e) => {
    if (!drag || !opts.accepts(drag)) return
    e.preventDefault()
    opts.onDrop(drag)
    drag = null
    clearIndicators()
  })
}
