import { BrowserWindow, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import type { ExtensionManager } from './extensions'
import type { TabManager } from './tab-manager'

export function buildMenu(
  win: BrowserWindow,
  tabs: TabManager,
  toggleBookmark: () => void,
  extensions: ExtensionManager,
): void {
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => tabs.createTab() },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            if (tabs.activeId) tabs.closeTab(tabs.activeId)
          },
        },
        {
          label: 'Close Other Tabs',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => {
            if (tabs.activeId) tabs.closeOtherTabs(tabs.activeId)
          },
        },
        {
          label: 'Close Tabs Below',
          accelerator: 'Control+CmdOrCtrl+Down',
          click: () => {
            if (tabs.activeId) tabs.closeTabsRight(tabs.activeId)
          },
        },
        {
          label: 'Close Tabs Above',
          accelerator: 'Control+CmdOrCtrl+Up',
          click: () => {
            if (tabs.activeId) tabs.closeTabsLeft(tabs.activeId)
          },
        },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Page',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (tabs.activeId) tabs.reload(tabs.activeId)
          },
        },
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: () => {
            if (tabs.activeId) tabs.back(tabs.activeId)
          },
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => {
            if (tabs.activeId) tabs.forward(tabs.activeId)
          },
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
        {
          label: 'Pin/Unpin Tab',
          accelerator: 'CmdOrCtrl+P',
          click: () => tabs.togglePin(tabs.activeId),
        },
        {
          label: 'Restore Pinned/Bookmarked URL',
          accelerator: 'Control+CmdOrCtrl+H',
          click: () => tabs.restoreAnchor(),
        },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Focus Address Bar',
          accelerator: 'CmdOrCtrl+L',
          click: () => tabs.focusUrlBar(),
        },
        { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: () => toggleBookmark() },
        {
          label: 'History',
          accelerator: 'CmdOrCtrl+Y',
          click: () => win.webContents.send('ui:toggle-history'),
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
