import type { Bookmark, BookmarkFolder, BookmarksData, TabsSnapshot } from '../shared/ipc'
import { wireDragItem, wireDropZone } from './drag-list'
import { loadSpinner } from './load-spinner'

const collapsed = new Set<string>()
// all folders start collapsed on the first render after launch; folders
// created afterward default to expanded
let seededInitialCollapse = false
// id of the folder or bookmark being renamed, 'new' while naming a new
// folder, null when idle — one inline editor at a time
let editing: string | null = null
let rerender: (() => void) | null = null

export function startItemEdit(id: string): void {
  editing = id
  rerender?.()
}

export function renderBookmarks(
  el: HTMLElement,
  data: BookmarksData,
  snap: TabsSnapshot,
  onRerender: () => void,
): void {
  rerender = onRerender
  const { folders, bookmarks } = data
  if (!seededInitialCollapse) {
    seededInitialCollapse = true
    for (const folder of folders) collapsed.add(folder.id)
  }
  el.innerHTML = ''

  const heading = document.createElement('div')
  heading.className = 'panel-heading'
  const label = document.createElement('span')
  label.textContent = 'Bookmarks'
  const newFolder = document.createElement('button')
  newFolder.className = 'panel-action'
  newFolder.textContent = '＋ Folder'
  newFolder.title = 'New Folder'
  newFolder.addEventListener('click', () => startItemEdit('new'))
  heading.append(label, newFolder)
  el.append(heading)

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
        el.append(
          editing === bm.id ? bookmarkEditor(bm, true) : bookmarkRow(bm, j, members, true, snap),
        ),
      )
    }
  })

  // loose bookmarks get their own container so its empty space below the
  // rows is a "move to top level" drop target
  const topLevel = bookmarks.filter((b) => !b.folderId)
  const loose = document.createElement('div')
  loose.className = 'bookmarks-loose'
  topLevel.forEach((bm, j) =>
    loose.append(
      editing === bm.id ? bookmarkEditor(bm, false) : bookmarkRow(bm, j, topLevel, false, snap),
    ),
  )
  wireDropZone(loose, {
    accepts: (d) => d.kind === 'bookmark' || d.kind === 'tab',
    onDrop: (d) => {
      if (d.kind === 'tab') window.synapse.bookmarks.createFromTab(d.id, null)
      else window.synapse.bookmarks.moveToFolder(d.id, null)
    },
  })
  el.append(loose)
}

function bookmarkRow(
  bm: Bookmark,
  index: number,
  siblings: Bookmark[],
  indented: boolean,
  snap: TabsSnapshot,
): HTMLDivElement {
  const tabId = snap.bookmarkTabs[bm.id]
  const tab = tabId ? snap.tabs[tabId] : undefined
  const row = document.createElement('div')
  row.className =
    'tab bookmark' +
    (tabId && tabId === snap.activeId ? ' active' : '') +
    (tab ? '' : ' asleep') +
    (indented ? ' indent' : '') +
    ((tab?.profile ?? bm.profile) === 'work' ? ' work' : '')

  let icon: HTMLElement
  if (tab?.isLoading) {
    icon = loadSpinner()
  } else {
    const img = document.createElement('img')
    img.className = 'favicon'
    img.onerror = () => (img.style.visibility = 'hidden')
    const src = tab?.favicon ?? bm.favicon
    if (src) img.src = src
    else img.style.visibility = 'hidden'
    icon = img
  }

  const title = document.createElement('span')
  title.className = 'tab-title'
  title.textContent = bm.title
  row.append(icon, title)

  if ((bm.profile ?? 'default') === 'work') {
    const dot = document.createElement('span')
    dot.className = 'profile-dot'
    dot.title = 'Work profile'
    row.append(dot)
  }

  if (tab) {
    const close = document.createElement('button')
    close.className = 'tab-close'
    close.textContent = '×'
    close.title = 'Put to sleep'
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      window.synapse.tabs.close(tabId!)
    })
    row.append(close)
  }

  // single click opens after a beat; a double-click cancels it and renames
  // instead, so renaming never navigates
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
    accepts: (d) => d.kind === 'bookmark' || d.kind === 'tab',
    onDrop: (d, before) => {
      let to = index + (before ? 0 : 1)
      if (d.kind === 'tab') {
        window.synapse.bookmarks.createFromTab(d.id, bm.folderId ?? null)
        return
      }
      // a sibling drag is a reorder; a drag from another container is a
      // position-preserving move into this row's container
      const from = siblings.findIndex((s) => s.id === d.id)
      if (from !== -1 && from < to) to -= 1
      if (from !== -1) window.synapse.bookmarks.reorder(d.id, to)
      else window.synapse.bookmarks.moveToFolder(d.id, bm.folderId ?? null, to)
    },
  })
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
    accepts: (d) => d.kind === 'folder' || d.kind === 'bookmark' || d.kind === 'tab',
    into: (d) => d.kind === 'bookmark' || d.kind === 'tab',
    onDrop: (d, before) => {
      if (d.kind === 'tab') {
        collapsed.delete(folder.id) // auto-expand so the drop is visible
        window.synapse.bookmarks.createFromTab(d.id, folder.id)
        return
      }
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

function inlineEditor(
  value: string,
  placeholder: string,
  onCommit: (v: string) => void,
): HTMLDivElement {
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
