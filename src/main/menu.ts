import { BrowserWindow, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import type { ExtensionManager } from './extensions'
import type { TabManager } from './tab-manager'

export interface MenuCommands {
  toggleBookmark(): void
  toggleSidebar(): void
  toggleSettings(): void
  exportBookmarks(): void
  importBookmarks(): void
}

export function buildMenu(
  win: BrowserWindow,
  tabs: TabManager,
  extensions: ExtensionManager,
  shortcuts: Record<string, string>,
  commands: MenuCommands,
): void {
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: shortcuts['new-tab'], click: () => tabs.createTab() },
        {
          label: 'Close Tab',
          accelerator: shortcuts['close-tab'],
          click: () => {
            if (tabs.activeId) tabs.closeTab(tabs.activeId)
          },
        },
        {
          label: 'Close Other Tabs',
          accelerator: shortcuts['close-other-tabs'],
          click: () => {
            if (tabs.activeId) tabs.closeOtherTabs(tabs.activeId)
          },
        },
        {
          label: 'Close Tabs Below',
          accelerator: shortcuts['close-tabs-below'],
          click: () => {
            if (tabs.activeId) tabs.closeTabsRight(tabs.activeId)
          },
        },
        {
          label: 'Close Tabs Above',
          accelerator: shortcuts['close-tabs-above'],
          click: () => {
            if (tabs.activeId) tabs.closeTabsLeft(tabs.activeId)
          },
        },
        { type: 'separator' },
        { label: 'Export Bookmarks…', click: () => commands.exportBookmarks() },
        { label: 'Import Bookmarks…', click: () => commands.importBookmarks() },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Page',
          accelerator: shortcuts['reload-page'],
          click: () => {
            if (tabs.activeId) tabs.reload(tabs.activeId)
          },
        },
        {
          label: 'Back',
          accelerator: shortcuts['back'],
          click: () => {
            if (tabs.activeId) tabs.back(tabs.activeId)
          },
        },
        {
          label: 'Forward',
          accelerator: shortcuts['forward'],
          click: () => {
            if (tabs.activeId) tabs.forward(tabs.activeId)
          },
        },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: shortcuts['zoom-in'], click: () => tabs.zoomActive(1) },
        { label: 'Zoom Out', accelerator: shortcuts['zoom-out'], click: () => tabs.zoomActive(-1) },
        { label: 'Actual Size', accelerator: shortcuts['zoom-reset'], click: () => tabs.zoomActive(0) },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: shortcuts['toggle-sidebar'],
          click: () => commands.toggleSidebar(),
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Tabs',
      submenu: [
        ...Array.from({ length: 9 }, (_, i): MenuItemConstructorOptions => ({
          label: i === 8 ? 'Last Tab' : `Tab ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => tabs.activateAt(i === 8 ? -1 : i),
        })),
        { type: 'separator' },
        { label: 'Next Tab', accelerator: shortcuts['next-tab'], click: () => tabs.activateSibling(1) },
        {
          label: 'Previous Tab',
          accelerator: shortcuts['prev-tab'],
          click: () => tabs.activateSibling(-1),
        },
        { type: 'separator' },
        {
          label: 'Pin/Unpin Tab',
          accelerator: shortcuts['pin-tab'],
          click: () => tabs.togglePin(tabs.activeId),
        },
        {
          label: 'Restore Pinned/Bookmarked URL',
          accelerator: shortcuts['restore-anchor'],
          click: () => tabs.restoreAnchor(),
        },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Focus Address Bar',
          accelerator: shortcuts['focus-urlbar'],
          click: () => tabs.focusUrlBar(),
        },
        {
          label: 'Bookmark This Page',
          accelerator: shortcuts['bookmark-page'],
          click: () => commands.toggleBookmark(),
        },
        {
          label: 'History',
          accelerator: shortcuts['history'],
          click: () => win.webContents.send('ui:toggle-history'),
        },
        {
          label: 'Settings…',
          accelerator: shortcuts['settings'],
          click: () => commands.toggleSettings(),
        },
        { type: 'separator' },
        {
          label: 'Extensions',
          submenu: extensions.list().map(({ id, name }) => ({
            label: name,
            submenu: [{ label: 'Remove…', click: () => void extensions.remove(id) }],
          })),
        },
        {
          label: 'Load Unpacked Extension…',
          click: () => void extensions.loadUnpacked(),
        },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
