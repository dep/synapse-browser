// Shared HTML5 drag-and-drop helper for the sidebar lists and the bookmarks
// panel. One drag runs at a time; `accepts` decides which targets react.
import { droppedOutsideViewport } from '../shared/drag-out'

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
  // instead of before/after it. The event and element let zone-sensitive
  // targets split the row: tab rows group on the middle band, reorder on
  // the edges (dragging a tab onto a tab creates a tab group).
  into?(drag: DragItem, e: DragEvent, el: HTMLElement): boolean
  onDrop(drag: DragItem, before: boolean, into: boolean): void
  // the drag ended outside the window with no internal drop having consumed
  // it (tab tear-out); e carries the final screen coordinates
  onDragOut?(e: DragEvent): void
}

export function wireDragItem(el: HTMLElement, self: DragItem, opts: DragItemOpts): void {
  el.draggable = true
  el.addEventListener('dragstart', (e) => {
    drag = self
    e.dataTransfer?.setData('text/plain', self.id)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  })
  el.addEventListener('dragend', (e) => {
    // an internal drop already nulled `drag`; a still-live drag that ended
    // beyond the viewport is a tear-out
    if (drag && opts.onDragOut && droppedOutsideViewport(e, window.innerWidth, window.innerHeight)) {
      opts.onDragOut(e)
    }
    drag = null
    clearIndicators()
  })
  el.addEventListener('dragover', (e) => {
    if (!drag || drag.id === self.id || !opts.accepts(drag)) return
    e.preventDefault()
    clearIndicators()
    if (opts.into?.(drag, e, el)) el.classList.add('drop-into')
    else el.classList.add(isBefore(e, el, opts.vertical ?? true) ? 'drop-before' : 'drop-after')
  })
  el.addEventListener('drop', (e) => {
    if (!drag || drag.id === self.id || !opts.accepts(drag)) return
    e.preventDefault()
    e.stopPropagation() // containers would otherwise treat this as an append
    const into = opts.into?.(drag, e, el) ?? false
    opts.onDrop(drag, into ? false : isBefore(e, el, opts.vertical ?? true), into)
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
    if (!drag || !opts.accepts(drag)) return
    e.preventDefault()
    // only when over the zone's own empty space — child rows draw their own
    // indicators and clear this one via clearIndicators()
    if (e.target === el) {
      clearIndicators()
      el.classList.add('drop-into')
    }
  })
  el.addEventListener('drop', (e) => {
    if (!drag || !opts.accepts(drag)) return
    e.preventDefault()
    opts.onDrop(drag)
    drag = null
    clearIndicators()
  })
}
