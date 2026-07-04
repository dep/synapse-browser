import './style.css'
import type { TabsSnapshot } from '../shared/ipc'
import { PanelMode, renderPanel } from './panel'
import { renderTabList } from './sidebar'
import { initTopbar } from './topbar'

const tabListEl = document.getElementById('tab-list')!
const panelEl = document.getElementById('panel')!
const topbar = initTopbar()

let snap: TabsSnapshot = { tabs: {}, order: [], activeId: null }
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

function setPanel(mode: PanelMode): void {
  panelMode = panelMode === mode ? 'none' : mode
  render()
}

function render(): void {
  renderTabList(tabListEl, snap)
  topbar.update(snap)
  tabListEl.hidden = panelMode !== 'none'
  panelEl.hidden = panelMode === 'none'
  void renderPanel(panelEl, panelMode)
}
