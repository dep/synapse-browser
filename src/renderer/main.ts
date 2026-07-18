import './style.css'
import { CANVAS_GAP, CANVAS_RADIUS } from '../shared/canvas-layout'
import type { BookmarksData, TabsSnapshot } from '../shared/ipc'
import type { PaneRect } from '../shared/split-layout'
import { renderBookmarks, startItemEdit } from './bookmarks-section'
import { PanelMode, renderPanel } from './panel'
import { renderPins, renderTabList } from './sidebar'
import { cancelRecording, renderSettings } from './settings'
import { initTopbar } from './topbar'
import { initFindBar } from './find-bar'
import { initLoadingBar } from './loading-bar'
import { initAiSidebar } from './ai-sidebar'
import { initNewTab } from './newtab'

const pinGridEl = document.getElementById('pin-grid')!
const bookmarksEl = document.getElementById('bookmarks')!
const tabListEl = document.getElementById('tab-list')!
const panelEl = document.getElementById('panel')!
const appEl = document.getElementById('app')!
const sidebarResizeEl = document.getElementById('sidebar-resize')!
const settingsEl = document.getElementById('settings')!
const newtab = initNewTab(document.getElementById('newtab')!)
let settingsOpen = false
const topbar = initTopbar()
const findBar = initFindBar()
const loadingBar = initLoadingBar()
const aiSidebar = initAiSidebar()
const aiResizeEl = document.getElementById('ai-resize')!
const aiToggleEl = document.getElementById('ai-toggle')!
appEl.style.setProperty('--gap', `${CANVAS_GAP}px`)
appEl.style.setProperty('--canvas-radius', `${CANVAS_RADIUS}px`)

let snap: TabsSnapshot = {
  tabs: {},
  order: [],
  pinned: [],
  bookmarkTabs: {},
  activeId: null,
  panes: [],
  role: 'primary',
}
let bookmarks: BookmarksData = { folders: [], bookmarks: [] }
let panelMode: PanelMode = 'none'

window.synapse.onTabsUpdated((s) => {
  snap = s
  render()
})

// Pane geometry comes from main (it positions the views); the renderer draws
// what the native views can't: the focused pane's glow lives in the canvas
// gaps around the pane, and a blank pane's cell hosts the new-tab document.
const paneGlowEl = document.getElementById('pane-glow')!
let paneRects: PaneRect[] = []
window.synapse.ui.onPaneRects((rects) => {
  paneRects = rects
  render()
})

function activePaneRect(): PaneRect['rect'] | undefined {
  if (settingsOpen || paneRects.length < 2 || !snap.activeId) return undefined
  return paneRects.find((p) => p.id === snap.activeId)?.rect
}

function renderPaneChrome(): void {
  const rect = activePaneRect()
  paneGlowEl.hidden = !rect
  if (rect) {
    paneGlowEl.style.left = `${rect.x}px`
    paneGlowEl.style.top = `${rect.y}px`
    paneGlowEl.style.width = `${rect.width}px`
    paneGlowEl.style.height = `${rect.height}px`
  }
  // a blank focused pane shows the new-tab page in its own cell, not the
  // full canvas; inline styles override the grid placement
  const newtabEl = document.getElementById('newtab')!
  if (rect) {
    newtabEl.style.position = 'fixed'
    newtabEl.style.left = `${rect.x}px`
    newtabEl.style.top = `${rect.y}px`
    newtabEl.style.width = `${rect.width}px`
    newtabEl.style.height = `${rect.height}px`
    newtabEl.style.padding = '0'
  } else {
    newtabEl.removeAttribute('style')
  }
}

// width is owned by main (it must position the page view); the renderer
// only initiates drags and renders pushed widths
window.synapse.ui.onSidebarWidth((px) => {
  appEl.style.setProperty('--sidebar-width', `${px}px`)
  sidebarResizeEl.style.left = `${px - 5}px`
})
window.synapse.ui.onSidebarVisible((visible) => {
  appEl.classList.toggle('sidebar-hidden', !visible)
})
// AI sidebar width/visibility are owned by main for the same reason
window.synapse.ui.onAiSidebarWidth((px) => {
  appEl.style.setProperty('--ai-width', `${px}px`)
})
window.synapse.ui.onAiSidebarVisible((visible) => {
  appEl.classList.toggle('ai-hidden', !visible)
  aiToggleEl.classList.toggle('active', visible)
  aiSidebar.setVisible(visible)
})
aiToggleEl.addEventListener('click', () => window.synapse.ai.toggleSidebar())
aiResizeEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  e.preventDefault()
  window.synapse.ui.startAiSidebarDrag()
})
window.synapse.ui.onSettings((open) => {
  settingsOpen = open
  findBar.close()
  settingsEl.hidden = !open
  if (open) renderSettings(settingsEl, 'general')
  else cancelRecording()
  render()
})
sidebarResizeEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  e.preventDefault()
  window.synapse.ui.startSidebarDrag()
})
// belt-and-braces alongside main's input-event/blur detection; main's
// end() no-ops when no drag is active
window.addEventListener('mouseup', () => {
  window.synapse.ui.endSidebarDrag()
  window.synapse.ui.endAiSidebarDrag()
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
  // chrome-aware accents (urlbar focus ring, canvas ring) follow the active
  // tab's profile
  const activeProfile = snap.activeId ? snap.tabs[snap.activeId]?.profile : undefined
  document.body.classList.toggle('profile-work', activeProfile === 'work')
  // secondary windows are ephemeral workspaces: no pins, no bookmarks, no AI
  const secondary = snap.role === 'secondary'
  document.body.classList.toggle('secondary', secondary)
  aiToggleEl.hidden = secondary
  renderPins(pinGridEl, snap)
  renderBookmarks(bookmarksEl, bookmarks, snap, render)
  renderTabList(tabListEl, snap)
  topbar.update(snap)
  findBar.update(snap)
  loadingBar.update(snap)
  const showSidebar = panelMode === 'none'
  pinGridEl.hidden = secondary || !showSidebar || snap.pinned.length === 0
  bookmarksEl.hidden = secondary || !showSidebar
  tabListEl.hidden = !showSidebar
  panelEl.hidden = showSidebar
  renderPaneChrome()
  newtab.update(snap, settingsOpen)
}
