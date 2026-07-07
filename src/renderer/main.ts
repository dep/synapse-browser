import './style.css'
import type { TabsSnapshot } from '../shared/ipc'
import { PanelMode, renderPanel, startFolderEdit } from './panel'
import { renderPins, renderTabList } from './sidebar'
import { initTopbar } from './topbar'

const pinGridEl = document.getElementById('pin-grid')!
const tabListEl = document.getElementById('tab-list')!
const panelEl = document.getElementById('panel')!
const topbar = initTopbar()

let snap: TabsSnapshot = { tabs: {}, order: [], pinned: [], activeId: null }
let panelMode: PanelMode = 'none'

window.synapse.onTabsUpdated((s) => {
  snap = s
  render()
})

document.getElementById('new-tab')!.addEventListener('click', () => window.synapse.tabs.create())
document.getElementById('show-history')!.addEventListener('click', () => setPanel('history'))
document.getElementById('show-bookmarks')!.addEventListener('click', () => setPanel('bookmarks'))
window.synapse.ui.onToggleHistory(() => setPanel('history'))
window.synapse.ui.onToggleBookmarks(() => setPanel('bookmarks'))
window.synapse.ui.onBookmarksChanged(() => {
  if (panelMode === 'bookmarks') void renderPanel(panelEl, panelMode)
})
window.synapse.ui.onEditFolder((id) => {
  if (panelMode === 'bookmarks') startFolderEdit(id)
})

function setPanel(mode: PanelMode): void {
  panelMode = panelMode === mode ? 'none' : mode
  void renderPanel(panelEl, panelMode)
  render()
}

function render(): void {
  renderPins(pinGridEl, snap)
  renderTabList(tabListEl, snap)
  topbar.update(snap)
  pinGridEl.hidden = panelMode !== 'none' || snap.pinned.length === 0
  tabListEl.hidden = panelMode !== 'none'
  panelEl.hidden = panelMode === 'none'
}
