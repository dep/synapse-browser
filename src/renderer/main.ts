import './style.css'
import type { TabsSnapshot } from '../shared/ipc'
import { renderTabList } from './sidebar'
import { initTopbar } from './topbar'

const tabListEl = document.getElementById('tab-list')!
const topbar = initTopbar()

let snap: TabsSnapshot = { tabs: {}, order: [], activeId: null }

window.synapse.onTabsUpdated((s) => {
  snap = s
  render()
})

document.getElementById('new-tab')!.addEventListener('click', () => window.synapse.tabs.create())

function render(): void {
  renderTabList(tabListEl, snap)
  topbar.update(snap)
}
