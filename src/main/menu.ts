import { Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import type { ExtensionManager } from './extensions'
import type { WindowBundle } from './window'

export interface MenuCommands {
  newWindow(): void
  toggleBookmark(b: WindowBundle): void
  toggleSidebar(b: WindowBundle): void
  toggleAiSidebar(b: WindowBundle): void
  toggleSettings(b: WindowBundle): void
  exportBookmarks(): void
  importBookmarks(): void
  checkForUpdates(): void
}

export interface MenuContext {
  // the window a menu command acts on, resolved at click time
  // (focused window, falling back to the primary)
  bundle(): WindowBundle | null
  extensions: ExtensionManager
  shortcuts: Record<string, string>
  commands: MenuCommands
}

export function buildMenu(ctx: MenuContext): void {
  const { shortcuts, commands, extensions } = ctx
  // every command resolves its target window when clicked, not when built —
  // the app menu is global while windows come and go
  const withBundle = (fn: (b: WindowBundle) => void) => (): void => {
    const b = ctx.bundle()
    if (b) fn(b)
  }
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: shortcuts['new-window'],
          click: () => commands.newWindow(),
        },
        {
          label: 'New Tab',
          accelerator: shortcuts['new-tab'],
          click: withBundle((b) => b.tabs.createTab()),
        },
        {
          label: 'Close Tab',
          accelerator: shortcuts['close-tab'],
          click: withBundle((b) => {
            if (b.tabs.activeId) b.tabs.closeTab(b.tabs.activeId)
          }),
        },
        {
          label: 'Reopen Closed Tab',
          accelerator: shortcuts['reopen-tab'],
          click: withBundle((b) => b.tabs.reopenClosedTab()),
        },
        {
          label: 'Close Other Tabs',
          accelerator: shortcuts['close-other-tabs'],
          click: withBundle((b) => {
            if (b.tabs.activeId) b.tabs.closeOtherTabs(b.tabs.activeId)
          }),
        },
        {
          label: 'Close Tabs Below',
          accelerator: shortcuts['close-tabs-below'],
          click: withBundle((b) => {
            if (b.tabs.activeId) b.tabs.closeTabsRight(b.tabs.activeId)
          }),
        },
        {
          label: 'Close Tabs Above',
          accelerator: shortcuts['close-tabs-above'],
          click: withBundle((b) => {
            if (b.tabs.activeId) b.tabs.closeTabsLeft(b.tabs.activeId)
          }),
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
          click: withBundle((b) => {
            if (b.tabs.activeId) b.tabs.reload(b.tabs.activeId)
          }),
        },
        {
          label: 'Back',
          accelerator: shortcuts['back'],
          click: withBundle((b) => {
            if (b.tabs.activeId) b.tabs.back(b.tabs.activeId)
          }),
        },
        {
          label: 'Forward',
          accelerator: shortcuts['forward'],
          click: withBundle((b) => {
            if (b.tabs.activeId) b.tabs.forward(b.tabs.activeId)
          }),
        },
        { type: 'separator' },
        {
          label: 'Find…',
          accelerator: shortcuts['find'],
          click: withBundle((b) => {
            // DOM focus() in the chrome renderer is not enough while a page
            // view holds native focus (same dance as focusUrlBar)
            b.win.webContents.focus()
            b.win.webContents.send('ui:find-open')
          }),
        },
        {
          label: 'Find Next',
          accelerator: shortcuts['find-next'],
          click: withBundle((b) => b.win.webContents.send('ui:find-step', 1)),
        },
        {
          label: 'Find Previous',
          accelerator: shortcuts['find-prev'],
          click: withBundle((b) => b.win.webContents.send('ui:find-step', -1)),
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: shortcuts['zoom-in'],
          click: withBundle((b) => b.tabs.zoomActive(1)),
        },
        {
          label: 'Zoom Out',
          accelerator: shortcuts['zoom-out'],
          click: withBundle((b) => b.tabs.zoomActive(-1)),
        },
        {
          label: 'Actual Size',
          accelerator: shortcuts['zoom-reset'],
          click: withBundle((b) => b.tabs.zoomActive(0)),
        },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: shortcuts['toggle-sidebar'],
          click: withBundle((b) => commands.toggleSidebar(b)),
        },
        {
          label: 'Toggle AI Sidebar',
          accelerator: shortcuts['toggle-ai-sidebar'],
          click: withBundle((b) => commands.toggleAiSidebar(b)),
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
          click: withBundle((b) => b.tabs.activateAt(i === 8 ? -1 : i)),
        })),
        { type: 'separator' },
        {
          label: 'Next Tab',
          accelerator: shortcuts['next-tab'],
          click: withBundle((b) => b.tabs.activateSibling(1)),
        },
        {
          label: 'Previous Tab',
          accelerator: shortcuts['prev-tab'],
          click: withBundle((b) => b.tabs.activateSibling(-1)),
        },
        { type: 'separator' },
        {
          label: 'Pin/Unpin Tab',
          accelerator: shortcuts['pin-tab'],
          click: withBundle((b) => b.tabs.togglePin(b.tabs.activeId)),
        },
        {
          label: 'Restore Pinned/Bookmarked URL',
          accelerator: shortcuts['restore-anchor'],
          click: withBundle((b) => b.tabs.restoreAnchor()),
        },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Focus Address Bar',
          accelerator: shortcuts['focus-urlbar'],
          click: withBundle((b) => b.tabs.focusUrlBar()),
        },
        {
          label: 'Bookmark This Page',
          accelerator: shortcuts['bookmark-page'],
          click: withBundle((b) => commands.toggleBookmark(b)),
        },
        {
          label: 'History',
          accelerator: shortcuts['history'],
          click: withBundle((b) => b.win.webContents.send('ui:toggle-history')),
        },
        {
          label: 'Settings…',
          accelerator: shortcuts['settings'],
          click: withBundle((b) => commands.toggleSettings(b)),
        },
        { label: 'Check for Updates…', click: () => commands.checkForUpdates() },
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
