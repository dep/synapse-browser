import type { Bookmark, BookmarkFolder } from '../shared/ipc'
import { wireDragItem, wireDropZone } from './drag-list'

export type PanelMode = 'none' | 'history' | 'bookmarks'

const collapsed = new Set<string>()
// id of the folder or bookmark being renamed, 'new' while naming a new
// folder, null when idle — one inline editor at a time
let editing: string | null = null
let rerender: (() => void) | null = null

export function startItemEdit(id: string): void {
  editing = id
  rerender?.()
}

export async function renderPanel(el: HTMLElement, mode: PanelMode): Promise<void> {
  rerender = mode === 'bookmarks' ? () => void renderPanel(el, mode) : null
  el.innerHTML = ''
  if (mode === 'none') return
  if (mode === 'history') return renderHistory(el)
  return renderBookmarks(el)
}

async function renderHistory(el: HTMLElement): Promise<void> {
  const heading = document.createElement('div')
  heading.className = 'panel-heading'
  heading.textContent = 'History'
  el.append(heading)
  const items = await window.synapse.history.list()
  if (items.length === 0) return renderEmpty(el, 'No history yet')
  for (const item of items) {
    const row = itemRow(item.title, item.url)
    row.addEventListener('click', () => window.synapse.tabs.create(item.url))
    el.append(row)
  }
}

async function renderBookmarks(el: HTMLElement): Promise<void> {
  const { folders, bookmarks } = await window.synapse.bookmarks.list()

  const heading = document.createElement('div')
  heading.className = 'panel-heading'
  const label = document.createElement('span')
  label.textContent = 'Bookmarks'
  const newFolder = document.createElement('button')
  newFolder.className = 'panel-action'
  newFolder.textContent = '＋ Folder'
  newFolder.title = 'New Folder'
  newFolder.addEventListener('click', () => {
    editing = 'new'
    rerender?.()
  })
  heading.append(label, newFolder)
  el.append(heading)

  if (folders.length === 0 && bookmarks.length === 0 && editing !== 'new') {
    return renderEmpty(el, 'No bookmarks yet')
  }

  if (editing === 'new') el.append(folderEditor(null))

  folders.forEach((folder, i) => {
    if (editing === folder.id) {
      el.append(folderEditor(folder))
      return
    }
    const members = bookmarks.filter((b) => b.folderId === folder.id)
    el.append(folderRow(folder, i, folders, members.length))
    if (!collapsed.has(folder.id)) {
      members.forEach((bm, j) =>
        el.append(editing === bm.id ? bookmarkEditor(bm, true) : bookmarkRow(bm, j, members, true)),
      )
    }
  })

  const topLevel = bookmarks.filter((b) => !b.folderId)
  if (folders.length > 0 && topLevel.length > 0) {
    const divider = document.createElement('div')
    divider.className = 'panel-divider'
    el.append(divider)
  }

  // loose bookmarks get their own container so its empty space below the
  // rows is a "move to top level" drop target
  const loose = document.createElement('div')
  loose.className = 'panel-loose'
  topLevel.forEach((bm, j) =>
    loose.append(editing === bm.id ? bookmarkEditor(bm, false) : bookmarkRow(bm, j, topLevel, false)),
  )
  wireDropZone(loose, {
    accepts: (d) => d.kind === 'bookmark',
    onDrop: (d) => window.synapse.bookmarks.moveToFolder(d.id, null),
  })
  el.append(loose)
}

function renderEmpty(el: HTMLElement, text: string): void {
  const empty = document.createElement('div')
  empty.className = 'panel-empty'
  empty.textContent = text
  el.append(empty)
}

function itemRow(title: string, url: string): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'panel-item'
  const titleEl = document.createElement('span')
  titleEl.className = 'panel-item-title'
  titleEl.textContent = title || url
  const urlEl = document.createElement('span')
  urlEl.className = 'panel-item-url'
  urlEl.textContent = url
  row.append(titleEl, urlEl)
  return row
}

function folderRow(
  folder: BookmarkFolder,
  index: number,
  folders: BookmarkFolder[],
  count: number,
): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'panel-item folder'
  const twist = document.createElement('span')
  twist.className = 'folder-twist'
  twist.textContent = collapsed.has(folder.id) ? '▸' : '▾'
  const name = document.createElement('span')
  name.className = 'folder-name'
  name.textContent = folder.name
  const countEl = document.createElement('span')
  countEl.className = 'folder-count'
  countEl.textContent = String(count)
  row.append(twist, name, countEl)
  row.addEventListener('click', () => {
    if (collapsed.has(folder.id)) collapsed.delete(folder.id)
    else collapsed.add(folder.id)
    rerender?.()
  })
  row.addEventListener('dblclick', () => startItemEdit(folder.id))
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    window.synapse.bookmarks.showContextMenu('folder', folder.id)
  })
  wireDragItem(row, { kind: 'folder', id: folder.id }, {
    accepts: (d) => d.kind === 'folder' || d.kind === 'bookmark',
    into: (d) => d.kind === 'bookmark',
    onDrop: (d, before) => {
      if (d.kind === 'bookmark') {
        collapsed.delete(folder.id) // auto-expand so the drop is visible
        window.synapse.bookmarks.moveToFolder(d.id, folder.id)
        return
      }
      const from = folders.findIndex((f) => f.id === d.id)
      let to = index + (before ? 0 : 1)
      if (from !== -1 && from < to) to -= 1
      window.synapse.bookmarks.reorder(d.id, to)
    },
  })
  return row
}

function bookmarkRow(
  bm: Bookmark,
  index: number,
  siblings: Bookmark[],
  indented: boolean,
): HTMLDivElement {
  const row = itemRow(bm.title, bm.url)
  if (indented) row.classList.add('indent')
  // single click opens after a beat; a double-click cancels it and renames
  // instead, so renaming never navigates the active tab
  let clickTimer: ReturnType<typeof setTimeout> | null = null
  row.addEventListener('click', () => {
    if (clickTimer) clearTimeout(clickTimer)
    clickTimer = setTimeout(() => window.synapse.bookmarks.open(bm.id), 250)
  })
  row.addEventListener('dblclick', () => {
    if (clickTimer) clearTimeout(clickTimer)
    clickTimer = null
    startItemEdit(bm.id)
  })
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    window.synapse.bookmarks.showContextMenu('bookmark', bm.id)
  })
  wireDragItem(row, { kind: 'bookmark', id: bm.id }, {
    accepts: (d) => d.kind === 'bookmark',
    onDrop: (d, before) => {
      // a sibling drag is a reorder; a drag from another container is a
      // position-preserving move into this row's container
      const from = siblings.findIndex((s) => s.id === d.id)
      let to = index + (before ? 0 : 1)
      if (from !== -1 && from < to) to -= 1
      if (from !== -1) window.synapse.bookmarks.reorder(d.id, to)
      else window.synapse.bookmarks.moveToFolder(d.id, bm.folderId ?? null, to)
    },
  })
  return row
}

function inlineEditor(value: string, placeholder: string, onCommit: (v: string) => void): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'panel-item folder'
  const input = document.createElement('input')
  input.className = 'folder-input'
  input.value = value
  input.placeholder = placeholder
  let done = false
  const finish = (commit: boolean): void => {
    if (done) return
    done = true
    editing = null
    const next = input.value.trim()
    if (commit && next) onCommit(next)
    // always exit edit mode locally — the ui:bookmarks-changed push then
    // repaints the committed value, and a lost push can't wedge the editor
    rerender?.()
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true)
    else if (e.key === 'Escape') finish(false)
  })
  // clicking away saves (Esc is the cancel gesture)
  input.addEventListener('blur', () => finish(true))
  row.append(input)
  queueMicrotask(() => input.focus())
  return row
}

function folderEditor(folder: BookmarkFolder | null): HTMLDivElement {
  return inlineEditor(folder?.name ?? '', 'Folder name', (name) => {
    if (folder) window.synapse.bookmarks.renameFolder(folder.id, name)
    else window.synapse.bookmarks.addFolder(name)
  })
}

function bookmarkEditor(bm: Bookmark, indented: boolean): HTMLDivElement {
  const row = inlineEditor(bm.title, 'Bookmark title', (title) =>
    window.synapse.bookmarks.rename(bm.id, title),
  )
  if (indented) row.classList.add('indent')
  return row
}
