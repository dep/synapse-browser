import './style.css'
import type { BookmarksData, TabsSnapshot } from '../shared/ipc'
import { renderBookmarks, startItemEdit } from './bookmarks-section'
import { PanelMode, renderPanel } from './panel'
import { renderPins, renderTabList } from './sidebar'
import { initTopbar } from './topbar'

const pinGridEl = document.getElementById('pin-grid')!
const bookmarksEl = document.getElementById('bookmarks')!
const tabListEl = document.getElementById('tab-list')!
const panelEl = document.getElementById('panel')!
const topbar = initTopbar()

let snap: TabsSnapshot = { tabs: {}, order: [], pinned: [], bookmarkTabs: {}, activeId: null }
let bookmarks: BookmarksData = { folders: [], bookmarks: [] }
let panelMode: PanelMode = 'none'

window.synapse.onTabsUpdated((s) => {
  snap = s
  render()
})

async function refreshBookmarks(): Promise<void> {
  bookmarks = await window.synapse.bookmarks.list()
  render()
}

document.getElementById('new-tab')!.addEventListener('click', () => window.synapse.tabs.create())
document.getElementById('show-history')!.addEventListener('click', () => setPanel('history'))
window.synapse.ui.onToggleHistory(() => setPanel('history'))
window.synapse.ui.onBookmarksChanged(() => void refreshBookmarks())
window.synapse.ui.onEditFolder((id) => startItemEdit(id))
window.synapse.ui.onEditBookmark((id) => startItemEdit(id))
void refreshBookmarks()

function setPanel(mode: PanelMode): void {
  panelMode = panelMode === mode ? 'none' : mode
  void renderPanel(panelEl, panelMode)
  render()
}

function render(): void {
  renderPins(pinGridEl, snap)
  renderBookmarks(bookmarksEl, bookmarks, snap, render)
  renderTabList(tabListEl, snap)
  topbar.update(snap)
  const showSidebar = panelMode === 'none'
  pinGridEl.hidden = !showSidebar || snap.pinned.length === 0
  bookmarksEl.hidden = !showSidebar
  tabListEl.hidden = !showSidebar
  panelEl.hidden = showSidebar
}
