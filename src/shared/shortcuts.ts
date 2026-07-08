export interface ShortcutCommand {
  id: string
  label: string
  default: string
}

// every rebindable menu command; ids are stable keys used by shortcuts.json
export const SHORTCUT_COMMANDS: ShortcutCommand[] = [
  { id: 'new-tab', label: 'New Tab', default: 'CmdOrCtrl+T' },
  { id: 'close-tab', label: 'Close Tab', default: 'CmdOrCtrl+W' },
  { id: 'close-other-tabs', label: 'Close Other Tabs', default: 'CmdOrCtrl+Shift+W' },
  { id: 'close-tabs-below', label: 'Close Tabs Below', default: 'Control+CmdOrCtrl+Down' },
  { id: 'close-tabs-above', label: 'Close Tabs Above', default: 'Control+CmdOrCtrl+Up' },
  { id: 'reload-page', label: 'Reload Page', default: 'CmdOrCtrl+R' },
  { id: 'back', label: 'Back', default: 'CmdOrCtrl+[' },
  { id: 'forward', label: 'Forward', default: 'CmdOrCtrl+]' },
  { id: 'find', label: 'Find…', default: 'CmdOrCtrl+F' },
  { id: 'find-next', label: 'Find Next', default: 'CmdOrCtrl+G' },
  { id: 'find-prev', label: 'Find Previous', default: 'CmdOrCtrl+Shift+G' },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', default: 'Control+S' },
  { id: 'zoom-in', label: 'Zoom In', default: 'CmdOrCtrl+=' },
  { id: 'zoom-out', label: 'Zoom Out', default: 'CmdOrCtrl+-' },
  { id: 'zoom-reset', label: 'Actual Size', default: 'CmdOrCtrl+0' },
  { id: 'next-tab', label: 'Next Tab', default: 'Alt+CmdOrCtrl+Down' },
  { id: 'prev-tab', label: 'Previous Tab', default: 'Alt+CmdOrCtrl+Up' },
  { id: 'pin-tab', label: 'Pin/Unpin Tab', default: 'CmdOrCtrl+P' },
  { id: 'restore-anchor', label: 'Restore Pinned/Bookmarked URL', default: 'Control+CmdOrCtrl+H' },
  { id: 'focus-urlbar', label: 'Focus Address Bar', default: 'CmdOrCtrl+L' },
  { id: 'bookmark-page', label: 'Bookmark This Page', default: 'CmdOrCtrl+D' },
  { id: 'history', label: 'History', default: 'CmdOrCtrl+Y' },
  { id: 'settings', label: 'Settings…', default: 'CmdOrCtrl+,' },
]

// shown read-only in settings: these bindings are not menu accelerators
// (cycling needs commit-on-modifier-release via before-input-event; Tab 1-9
// is a static menu block)
export const FIXED_SHORTCUTS: Array<{ id: string; label: string; accelerator: string }> = [
  { id: 'cycle-mru', label: 'Cycle Tabs (recent first)', accelerator: 'Ctrl+Tab / Ctrl+Shift+Tab' },
  { id: 'cycle-order', label: 'Cycle Tabs (sidebar order)', accelerator: 'Option+Tab / Option+Shift+Tab' },
  { id: 'goto-tab', label: 'Go to Tab 1–9', accelerator: 'Cmd+1 … Cmd+9' },
]

// chords owned by macOS menu roles or the static Tab 1-9 block — never
// recordable as command overrides (normalized mac spellings)
export const RESERVED_ACCELERATORS: ReadonlySet<string> = new Set([
  'Cmd+Q',
  'Cmd+H',
  'Alt+Cmd+H',
  'Cmd+Z',
  'Shift+Cmd+Z',
  'Cmd+X',
  'Cmd+C',
  'Cmd+V',
  'Cmd+A',
  'Cmd+M',
  'Alt+Cmd+I',
  ...Array.from({ length: 9 }, (_, i) => `Cmd+${i + 1}`),
])

export function resolveShortcuts(overrides: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const cmd of SHORTCUT_COMMANDS) {
    const o = overrides[cmd.id]
    resolved[cmd.id] = typeof o === 'string' && o.length > 0 ? o : cmd.default
  }
  return resolved
}
