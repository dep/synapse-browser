# Issue Batch Implementation Plan (#2, #4, #5, #8, #10, #11)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sidebar toggle (Ctrl+S), page zoom (Cmd+=/−/0), order traversal (Alt+Cmd+Up/Down), a Settings view (Cmd+,) with a re-recordable keyboard-shortcuts page, and bookmarks JSON export/import.

**Architecture:** Menu accelerators become data: an Electron-free registry (`src/shared/shortcuts.ts`) merged with a `shortcuts.json` overrides store resolves every menu binding, and the menu is rebuilt on change. Settings render in the chrome renderer's page cell while main detaches the page view (native views draw above the chrome renderer). Bookmarks IO validation/merge-planning is pure and Vitest-covered; main only does dialogs and store calls.

**Tech Stack:** Electron 43, TypeScript strict, Vitest, vanilla DOM, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-08-issue-batch-design.md`

## Global Constraints

- TypeScript strict; `npm run typecheck` must pass before any task is done.
- No new npm dependencies; no UI framework in the renderer.
- Pure logic in `src/shared/` with Vitest coverage in `tests/`.
- Short conventional commits (`feat:`, `fix:`, `chore:`).
- IPC channel names exactly as written in each task.
- Registry command ids exactly as listed in Task 1 — later tasks depend on them.

---

### Task 1: Shortcuts registry (shared)

**Files:**
- Create: `src/shared/shortcuts.ts`
- Test: `tests/shortcuts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ShortcutCommand { id: string; label: string; default: string }`,
  `SHORTCUT_COMMANDS: ShortcutCommand[]`,
  `FIXED_SHORTCUTS: Array<{ id: string; label: string; accelerator: string }>`,
  `resolveShortcuts(overrides: Record<string, string>): Record<string, string>`.

- [ ] **Step 1: Write the failing test**

Create `tests/shortcuts.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { SHORTCUT_COMMANDS, resolveShortcuts } from '../src/shared/shortcuts'

describe('resolveShortcuts', () => {
  it('returns every command default when no overrides', () => {
    const resolved = resolveShortcuts({})
    expect(Object.keys(resolved).sort()).toEqual(SHORTCUT_COMMANDS.map((c) => c.id).sort())
    expect(resolved['new-tab']).toBe('CmdOrCtrl+T')
    expect(resolved['toggle-sidebar']).toBe('Control+S')
    expect(resolved['settings']).toBe('CmdOrCtrl+,')
  })

  it('applies overrides for known ids', () => {
    expect(resolveShortcuts({ 'zoom-in': 'Cmd+Shift+I' })['zoom-in']).toBe('Cmd+Shift+I')
  })

  it('ignores unknown ids and non-string values', () => {
    const resolved = resolveShortcuts({ nope: 'Cmd+X', 'zoom-out': 7 as unknown as string })
    expect(resolved['nope']).toBeUndefined()
    expect(resolved['zoom-out']).toBe('CmdOrCtrl+-')
  })

  it('has unique ids and non-empty defaults', () => {
    const ids = SHORTCUT_COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of SHORTCUT_COMMANDS) expect(c.default.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shortcuts.test.ts`
Expected: FAIL — cannot resolve `../src/shared/shortcuts`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/shortcuts.ts`:

```typescript
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

export function resolveShortcuts(overrides: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const cmd of SHORTCUT_COMMANDS) {
    const o = overrides[cmd.id]
    resolved[cmd.id] = typeof o === 'string' && o.length > 0 ? o : cmd.default
  }
  return resolved
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shortcuts.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/shortcuts.ts tests/shortcuts.test.ts
git commit -m "feat: shortcut command registry with override resolution"
```

---

### Task 2: Shortcuts overrides store

**Files:**
- Create: `src/main/shortcuts-store.ts`
- Test: `tests/shortcuts-store.test.ts`

**Interfaces:**
- Consumes: `JsonStore` (`src/main/store.ts`), Task 1's `resolveShortcuts`.
- Produces: `class ShortcutsStore` with `constructor(dir: string)`,
  `resolved(): Record<string, string>`, `overrides(): Record<string, string>`,
  `set(id: string, accelerator: string): void`, `reset(id: string): void`,
  `resetAll(): void`, `flush(): void`.

- [ ] **Step 1: Write the failing test**

Create `tests/shortcuts-store.test.ts`:

```typescript
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShortcutsStore } from '../src/main/shortcuts-store'

describe('ShortcutsStore', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('resolves to defaults when empty', () => {
    expect(new ShortcutsStore(dir).resolved()['new-tab']).toBe('CmdOrCtrl+T')
  })

  it('set() overrides and round-trips through disk', () => {
    const store = new ShortcutsStore(dir)
    store.set('new-tab', 'Cmd+Shift+T')
    store.flush()
    expect(new ShortcutsStore(dir).resolved()['new-tab']).toBe('Cmd+Shift+T')
  })

  it('reset() removes a single override', () => {
    const store = new ShortcutsStore(dir)
    store.set('new-tab', 'Cmd+Shift+T')
    store.set('history', 'Cmd+H')
    store.reset('new-tab')
    expect(store.resolved()['new-tab']).toBe('CmdOrCtrl+T')
    expect(store.resolved()['history']).toBe('Cmd+H')
  })

  it('resetAll() removes every override', () => {
    const store = new ShortcutsStore(dir)
    store.set('new-tab', 'Cmd+Shift+T')
    store.resetAll()
    expect(store.overrides()).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shortcuts-store.test.ts`
Expected: FAIL — cannot resolve `../src/main/shortcuts-store`.

- [ ] **Step 3: Write the implementation**

Create `src/main/shortcuts-store.ts`:

```typescript
import * as path from 'node:path'
import { resolveShortcuts } from '../shared/shortcuts'
import { JsonStore } from './store'

interface ShortcutsFile {
  v: 1
  overrides: Record<string, string>
}

export class ShortcutsStore {
  private store: JsonStore<ShortcutsFile>

  constructor(dir: string) {
    this.store = new JsonStore<ShortcutsFile>(path.join(dir, 'shortcuts.json'), {
      v: 1,
      overrides: {},
    })
  }

  overrides(): Record<string, string> {
    const o = this.store.get().overrides
    return o && typeof o === 'object' ? o : {}
  }

  resolved(): Record<string, string> {
    return resolveShortcuts(this.overrides())
  }

  set(id: string, accelerator: string): void {
    this.store.set({ v: 1, overrides: { ...this.overrides(), [id]: accelerator } })
  }

  reset(id: string): void {
    const next = { ...this.overrides() }
    delete next[id]
    this.store.set({ v: 1, overrides: next })
  }

  resetAll(): void {
    this.store.set({ v: 1, overrides: {} })
  }

  flush(): void {
    this.store.flush()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shortcuts-store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/shortcuts-store.ts tests/shortcuts-store.test.ts
git commit -m "feat: shortcuts.json overrides store"
```

---

### Task 3: TabManager commands + ui-store sidebarVisible

**Files:**
- Modify: `src/main/ui-store.ts`
- Modify: `src/main/tab-manager.ts`
- Test: `tests/ui-store.test.ts` (extend)

**Interfaces:**
- Consumes: existing `UiStore`, `TabManager` (`layout()`, `model.order`, `activateTab`, `attached`).
- Produces: `UiStore.sidebarVisible(): boolean`, `UiStore.setSidebarVisible(v: boolean): void`
  (and `setSidebarWidth` must now PRESERVE `sidebarVisible` — the current
  implementation writes a fresh object and would wipe it);
  `TabManager.setSidebarVisible(visible: boolean): void`,
  `TabManager.zoomActive(delta: 1 | -1 | 0): void`,
  `TabManager.activateSibling(dir: 1 | -1): void`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui-store.test.ts` inside the existing `describe('UiStore')`:

```typescript
  it('sidebarVisible defaults to true and round-trips false', () => {
    const store = new UiStore(dir)
    expect(store.sidebarVisible()).toBe(true)
    store.setSidebarVisible(false)
    store.flush()
    expect(new UiStore(dir).sidebarVisible()).toBe(false)
  })

  it('setSidebarWidth preserves sidebarVisible and vice versa', () => {
    const store = new UiStore(dir)
    store.setSidebarVisible(false)
    store.setSidebarWidth(300)
    store.flush()
    const again = new UiStore(dir)
    expect(again.sidebarVisible()).toBe(false)
    expect(again.sidebarWidth()).toBe(300)
  })

  it('treats non-boolean stored sidebarVisible as true', () => {
    fs.writeFileSync(
      path.join(dir, 'ui.json'),
      JSON.stringify({ v: 1, sidebarWidth: 240, sidebarVisible: 'nope' }),
    )
    expect(new UiStore(dir).sidebarVisible()).toBe(true)
  })
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/ui-store.test.ts`
Expected: FAIL — `sidebarVisible is not a function`.

- [ ] **Step 3: Implement UiStore changes**

Replace the body of `src/main/ui-store.ts`'s class (keep imports; extend `UiFile`):

```typescript
interface UiFile {
  v: 1
  sidebarWidth: number
  sidebarVisible: boolean
}

export class UiStore {
  private store: JsonStore<UiFile>

  constructor(dir: string) {
    this.store = new JsonStore<UiFile>(path.join(dir, 'ui.json'), {
      v: 1,
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      sidebarVisible: true,
    })
  }

  // clamp on read too: the file is user-editable and may carry garbage
  sidebarWidth(): number {
    return clampSidebarWidth(this.store.get().sidebarWidth)
  }

  sidebarVisible(): boolean {
    return this.store.get().sidebarVisible !== false
  }

  setSidebarWidth(px: number): void {
    this.store.set({ ...this.normalized(), sidebarWidth: clampSidebarWidth(px) })
  }

  setSidebarVisible(visible: boolean): void {
    this.store.set({ ...this.normalized(), sidebarVisible: visible })
  }

  flush(): void {
    this.store.flush()
  }

  private normalized(): UiFile {
    return { v: 1, sidebarWidth: this.sidebarWidth(), sidebarVisible: this.sidebarVisible() }
  }
}
```

- [ ] **Step 4: Implement TabManager methods**

In `src/main/tab-manager.ts`, next to `private sidebarWidth = SIDEBAR_WIDTH_DEFAULT` add:

```typescript
private sidebarVisible = true
```

Next to `setSidebarWidth` add:

```typescript
setSidebarVisible(visible: boolean): void {
  this.sidebarVisible = visible
  this.layout()
}

// zoom the active page; Chromium's practical zoom-level range is about -7..9
zoomActive(delta: 1 | -1 | 0): void {
  const wc = this.attached?.webContents
  if (!wc) return
  wc.setZoomLevel(delta === 0 ? 0 : Math.max(-7, Math.min(9, wc.getZoomLevel() + delta)))
}

// immediate prev/next in sidebar order with wraparound — unlike Ctrl+Tab MRU
// cycling there is no preview/commit phase. Pins and bookmark slots are not
// in `order`; when one is active, dir 1 starts at the first order tab and
// dir -1 at the last.
activateSibling(dir: 1 | -1): void {
  const order = this.model.order
  if (order.length === 0) return
  const i = this.model.activeId ? order.indexOf(this.model.activeId) : -1
  const next = i === -1 ? (dir === 1 ? 0 : order.length - 1) : (i + dir + order.length) % order.length
  this.activateTab(order[next]!)
}
```

In `layout()`, change the `x`/`width` lines to use effective width:

```typescript
private layout(): void {
  if (!this.attached) return
  const [w, h] = this.win.getContentSize()
  const top = TOPBAR_HEIGHT + this.overlayHeight
  const left = this.sidebarVisible ? this.sidebarWidth : 0
  this.attached.setBounds({
    x: left,
    y: top,
    width: Math.max(0, w - left),
    height: Math.max(0, h - top),
  })
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test`
Expected: both clean (ui-store suite now 8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/ui-store.ts src/main/tab-manager.ts tests/ui-store.test.ts
git commit -m "feat: sidebar visibility state, page zoom, order traversal in tab-manager"
```

---

### Task 4: Sidebar visibility IPC + renderer

**Files:**
- Modify: `src/shared/ipc.ts` (ui block)
- Modify: `src/preload/index.ts` (ui block)
- Modify: `src/renderer/main.ts`
- Modify: `src/renderer/style.css`

**Interfaces:**
- Consumes: Task 3's `TabManager.setSidebarVisible` (wired by Task 5's index.ts changes; this task is renderer/IPC only).
- Produces: `SynapseApi.ui.onSidebarVisible(cb: (visible: boolean) => void): void`
  over channel `ui:sidebar-visible`; renderer CSS-variable width plumbing that
  Task 5's main wiring pushes into.

- [ ] **Step 1: IPC type + preload**

In `src/shared/ipc.ts` `ui:` block, after `onSidebarWidth(...)` add:

```typescript
onSidebarVisible(cb: (visible: boolean) => void): void
```

In `src/preload/index.ts` `ui:` object, after the `onSidebarWidth` entry add:

```typescript
onSidebarVisible: (cb) => {
  ipcRenderer.on('ui:sidebar-visible', (_e, visible) => cb(visible))
},
```

- [ ] **Step 2: Renderer — width via CSS variable, visibility via class**

The width push currently sets `gridTemplateColumns` inline, which would defeat
a visibility class. In `src/renderer/main.ts`, replace the `onSidebarWidth`
callback body:

```typescript
window.synapse.ui.onSidebarWidth((px) => {
  appEl.style.setProperty('--sidebar-width', `${px}px`)
  sidebarResizeEl.style.left = `${px - 5}px`
})
window.synapse.ui.onSidebarVisible((visible) => {
  appEl.classList.toggle('sidebar-hidden', !visible)
})
```

- [ ] **Step 3: CSS**

In `src/renderer/style.css`, change the `#app` rule's column definition and add
hidden-state rules after it:

```css
#app {
  display: grid;
  grid-template-rows: 52px 1fr;
  grid-template-columns: var(--sidebar-width, 240px) 1fr;
  height: 100vh;
}
#app.sidebar-hidden {
  grid-template-columns: 0 1fr;
}
#app.sidebar-hidden #sidebar,
#app.sidebar-hidden #sidebar-resize {
  display: none;
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/renderer/main.ts src/renderer/style.css
git commit -m "feat: sidebar visibility IPC and renderer collapse"
```

---

### Task 5: Menu from registry + new commands (#2, #8, #10)

**Files:**
- Modify: `src/main/menu.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: Task 1's `resolveShortcuts` output shape; Task 2's `ShortcutsStore`;
  Task 3's `TabManager.setSidebarVisible/zoomActive/activateSibling`;
  Task 3's `UiStore.sidebarVisible/setSidebarVisible`.
- Produces: `buildMenu(win, tabs, extensions, shortcuts: Record<string, string>,
  commands: MenuCommands)` where
  `MenuCommands { toggleBookmark(): void; toggleSidebar(): void;
  toggleSettings(): void; exportBookmarks(): void; importBookmarks(): void }`;
  a `rebuildMenu()` closure in index.ts that Tasks 6/8 call after changes.
  For THIS task `toggleSettings`, `exportBookmarks`, `importBookmarks` are
  wired to no-op placeholders in index.ts (`() => {}`) — Tasks 6 and 11
  replace them; the menu items exist from this task onward.

- [ ] **Step 1: Rewrite `src/main/menu.ts`**

```typescript
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
```

- [ ] **Step 2: Wire index.ts**

In `src/main/index.ts`:

Add imports: `ShortcutsStore` from `./shortcuts-store` (and keep existing ones).

Next to the other store constructions:

```typescript
const shortcutsStore = new ShortcutsStore(userData)
```

After the `const sidebarResize = new SidebarResizeController(...)` block:

```typescript
const toggleSidebar = (): void => {
  const visible = !uiStore.sidebarVisible()
  uiStore.setSidebarVisible(visible)
  tabs.setSidebarVisible(visible)
  win.webContents.send('ui:sidebar-visible', visible)
}
tabs.setSidebarVisible(uiStore.sidebarVisible())
```

Replace the existing `buildMenu(win, tabs, toggleBookmark, extensions)` call and
the two session `extension-loaded`/`extension-unloaded` listeners with:

```typescript
const rebuildMenu = (): void =>
  buildMenu(win, tabs, extensions, shortcutsStore.resolved(), {
    toggleBookmark,
    toggleSidebar,
    toggleSettings: () => {},
    exportBookmarks: () => {},
    importBookmarks: () => {},
  })
rebuildMenu()
// the Tools → Extensions submenu lists installed extensions; rebuild it as they change
session.defaultSession.on('extension-loaded', rebuildMenu)
session.defaultSession.on('extension-unloaded', rebuildMenu)
```

In the `did-finish-load` handler, after the `ui:sidebar-width` send add:

```typescript
win.webContents.send('ui:sidebar-visible', uiStore.sidebarVisible())
```

In `before-quit`, add `shortcutsStore.flush()` alongside the other flushes.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/menu.ts src/main/index.ts
git commit -m "feat: registry-driven menu; sidebar toggle, zoom, tab traversal commands"
```

---

### Task 6: Settings view shell (#4)

**Files:**
- Modify: `src/main/tab-manager.ts`
- Modify: `src/main/index.ts`
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`
- Create: `src/renderer/settings.ts`
- Modify: `src/renderer/index.html`, `src/renderer/main.ts`, `src/renderer/style.css`

**Interfaces:**
- Consumes: Task 5's `rebuildMenu` closure and `MenuCommands.toggleSettings` slot.
- Produces: `TabManager.toggleSettings(): boolean` and
  `TabManagerOptions.onSettingsClosed?(): void`; channel `ui:settings`
  (boolean push); `SynapseApi.ui.onSettings(cb: (open: boolean) => void)`;
  renderer `renderSettings(el: HTMLElement, section: SettingsSection): void`
  with `type SettingsSection = 'general' | 'shortcuts'` (Task 9 fills the
  shortcuts section; this task renders a placeholder for it).

- [ ] **Step 1: TabManager settings mode**

In `src/main/tab-manager.ts`:

Add to `TabManagerOptions`:

```typescript
onSettingsClosed?(): void
```

Add field near `overlayHeight`:

```typescript
private settingsOpen = false
```

Add method next to `setSidebarVisible`:

```typescript
// while settings is open no page view is attached, so the chrome renderer
// (which draws the settings UI in the page cell) is fully visible
toggleSettings(): boolean {
  this.settingsOpen = !this.settingsOpen
  this.syncViews()
  return this.settingsOpen
}
```

In `syncViews()`, change the `active` computation to respect the flag:

```typescript
const active =
  !this.settingsOpen && this.model.activeId
    ? (this.views.get(this.model.activeId) ?? null)
    : null
```

In `activateTab(id)` and `createTab(...)`, at the START of each method body add
the close-on-activation hook:

```typescript
if (this.settingsOpen) {
  this.settingsOpen = false
  this.opts.onSettingsClosed?.()
}
```

(For `createTab` place it before the id is generated.)

- [ ] **Step 2: IPC + preload**

`src/shared/ipc.ts` ui block, after `onSidebarVisible` add:

```typescript
onSettings(cb: (open: boolean) => void): void
```

`src/preload/index.ts` ui object:

```typescript
onSettings: (cb) => {
  ipcRenderer.on('ui:settings', (_e, open) => cb(open))
},
```

- [ ] **Step 3: index.ts wiring**

In `src/main/index.ts`, replace the `toggleSettings: () => {},` placeholder in
`rebuildMenu` with:

```typescript
toggleSettings: () => win.webContents.send('ui:settings', tabs.toggleSettings()),
```

In the `TabManager` options object (the big literal), add:

```typescript
onSettingsClosed: () => win.webContents.send('ui:settings', false),
```

- [ ] **Step 4: Renderer settings shell**

Create `src/renderer/settings.ts`:

```typescript
export type SettingsSection = 'general' | 'shortcuts'

export function renderSettings(el: HTMLElement, section: SettingsSection): void {
  el.innerHTML = ''
  const nav = document.createElement('nav')
  nav.id = 'settings-nav'
  const body = document.createElement('div')
  body.id = 'settings-body'

  const sections: Array<{ id: SettingsSection; label: string }> = [
    { id: 'general', label: 'General' },
    { id: 'shortcuts', label: 'Keyboard Shortcuts' },
  ]
  for (const s of sections) {
    const btn = document.createElement('button')
    btn.className = 'settings-nav-item' + (s.id === section ? ' active' : '')
    btn.textContent = s.label
    btn.addEventListener('click', () => renderSettings(el, s.id))
    nav.append(btn)
  }

  const heading = document.createElement('h1')
  heading.textContent = sections.find((s) => s.id === section)!.label
  body.append(heading)

  if (section === 'general') {
    const empty = document.createElement('p')
    empty.className = 'settings-empty'
    empty.textContent = 'No settings yet.'
    body.append(empty)
  } else {
    renderShortcutsSection(body)
  }

  el.append(nav, body)
}

// placeholder until the shortcuts settings task fills it in
function renderShortcutsSection(body: HTMLElement): void {
  const empty = document.createElement('p')
  empty.className = 'settings-empty'
  empty.textContent = 'Coming soon.'
  body.append(empty)
}
```

In `src/renderer/index.html`, after the `</aside>` line and before
`<div id="sidebar-resize"></div>` add:

```html
<main id="settings" hidden></main>
```

In `src/renderer/main.ts` add near the other element refs:

```typescript
const settingsEl = document.getElementById('settings')!
```

Add import: `import { renderSettings } from './settings'`.

After the `onSidebarVisible` wiring add:

```typescript
window.synapse.ui.onSettings((open) => {
  settingsEl.hidden = !open
  if (open) renderSettings(settingsEl, 'general')
})
```

In `src/renderer/style.css` append:

```css
#settings {
  grid-row: 2;
  grid-column: 2;
  display: flex;
  gap: 24px;
  padding: 24px;
  overflow-y: auto;
  background: var(--bg);
}
#settings[hidden] {
  display: none;
}
#settings-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 180px;
}
.settings-nav-item {
  text-align: left;
  background: none;
  border: none;
  color: var(--fg);
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.settings-nav-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
.settings-nav-item.active {
  background: var(--bg-raised);
}
#settings-body {
  flex: 1;
  max-width: 640px;
}
#settings-body h1 {
  font-size: 18px;
  margin-bottom: 16px;
}
.settings-empty {
  color: var(--fg-dim);
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/tab-manager.ts src/main/index.ts src/shared/ipc.ts src/preload/index.ts src/renderer/settings.ts src/renderer/index.html src/renderer/main.ts src/renderer/style.css
git commit -m "feat: settings view shell behind Cmd+, with page-view detach"
```

---

### Task 7: Accelerator helpers (shared)

**Files:**
- Create: `src/shared/accelerator.ts`
- Test: `tests/accelerator.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `KeyEventLike { key: string; code: string; metaKey: boolean;
  ctrlKey: boolean; altKey: boolean; shiftKey: boolean }`,
  `acceleratorFromKeyEvent(e: KeyEventLike): string | null`,
  `normalizeAccelerator(accel: string, isMac: boolean): string` (for conflict
  comparison: `CmdOrCtrl`/`CommandOrControl` → `Cmd` on mac else `Control`;
  `Command` → `Cmd`; `Option` → `Alt`; case-insensitive; parts sorted with the
  key last kept in place).

- [ ] **Step 1: Write the failing test**

Create `tests/accelerator.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { acceleratorFromKeyEvent, normalizeAccelerator } from '../src/shared/accelerator'

const ev = (over: Partial<Parameters<typeof acceleratorFromKeyEvent>[0]>) => ({
  key: 'a',
  code: 'KeyA',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
})

describe('acceleratorFromKeyEvent', () => {
  it('builds modifier+letter chords with canonical order', () => {
    expect(acceleratorFromKeyEvent(ev({ metaKey: true }))).toBe('Cmd+A')
    expect(
      acceleratorFromKeyEvent(ev({ ctrlKey: true, altKey: true, shiftKey: true, metaKey: true })),
    ).toBe('Control+Alt+Shift+Cmd+A')
  })

  it('rejects chords without a non-shift modifier (except F-keys)', () => {
    expect(acceleratorFromKeyEvent(ev({}))).toBeNull()
    expect(acceleratorFromKeyEvent(ev({ shiftKey: true }))).toBeNull()
    expect(acceleratorFromKeyEvent(ev({ key: 'F5', code: 'F5' }))).toBe('F5')
  })

  it('rejects pure modifier presses and Escape', () => {
    expect(acceleratorFromKeyEvent(ev({ key: 'Meta', code: 'MetaLeft', metaKey: true }))).toBeNull()
    expect(acceleratorFromKeyEvent(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBeNull()
    expect(acceleratorFromKeyEvent(ev({ key: 'Escape', code: 'Escape', metaKey: true }))).toBeNull()
  })

  it('normalizes arrows, space, plus and digits', () => {
    expect(acceleratorFromKeyEvent(ev({ key: 'ArrowUp', code: 'ArrowUp', altKey: true, metaKey: true }))).toBe(
      'Alt+Cmd+Up',
    )
    expect(acceleratorFromKeyEvent(ev({ key: ' ', code: 'Space', ctrlKey: true }))).toBe('Control+Space')
    expect(acceleratorFromKeyEvent(ev({ key: '+', code: 'Equal', metaKey: true, shiftKey: true }))).toBe(
      'Shift+Cmd+Plus',
    )
    expect(acceleratorFromKeyEvent(ev({ key: '!', code: 'Digit1', metaKey: true, shiftKey: true }))).toBe(
      'Shift+Cmd+1',
    )
  })

  it('passes punctuation through', () => {
    expect(acceleratorFromKeyEvent(ev({ key: ',', code: 'Comma', metaKey: true }))).toBe('Cmd+,')
    expect(acceleratorFromKeyEvent(ev({ key: '[', code: 'BracketLeft', metaKey: true }))).toBe('Cmd+[')
  })
})

describe('normalizeAccelerator', () => {
  it('maps CmdOrCtrl per platform', () => {
    expect(normalizeAccelerator('CmdOrCtrl+T', true)).toBe('Cmd+T')
    expect(normalizeAccelerator('CmdOrCtrl+T', false)).toBe('Control+T')
    expect(normalizeAccelerator('CommandOrControl+T', true)).toBe('Cmd+T')
  })

  it('canonicalizes aliases and case', () => {
    expect(normalizeAccelerator('command+shift+t', true)).toBe('Shift+Cmd+T')
    expect(normalizeAccelerator('Option+cmd+Up', true)).toBe('Alt+Cmd+Up')
  })

  it('detects equality across styles', () => {
    expect(normalizeAccelerator('CmdOrCtrl+=', true)).toBe(normalizeAccelerator('Cmd+=', true))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/accelerator.test.ts`
Expected: FAIL — cannot resolve `../src/shared/accelerator`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/accelerator.ts`:

```typescript
export interface KeyEventLike {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta'])

const KEY_NAMES: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
  '+': 'Plus',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
}

function keyName(e: KeyEventLike): string | null {
  if (MODIFIER_KEYS.has(e.key) || e.key === 'Escape') return null
  // digits by physical key so Shift+1 records as 1, not !
  const digit = /^Digit(\d)$/.exec(e.code)
  if (digit) return digit[1]!
  if (KEY_NAMES[e.key]) return KEY_NAMES[e.key]!
  if (/^F([1-9]|1\d|2[0-4])$/.test(e.key)) return e.key
  if (e.key.length === 1) return /[a-z]/i.test(e.key) ? e.key.toUpperCase() : e.key
  return null
}

// build an Electron accelerator from a renderer KeyboardEvent; null when the
// chord isn't recordable (no non-shift modifier, pure modifier press, Esc)
export function acceleratorFromKeyEvent(e: KeyEventLike): string | null {
  const key = keyName(e)
  if (!key) return null
  const isFKey = /^F([1-9]|1\d|2[0-4])$/.test(key)
  if (!isFKey && !e.ctrlKey && !e.altKey && !e.metaKey) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Control')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Cmd')
  parts.push(key)
  return parts.join('+')
}

const MOD_ORDER = ['Control', 'Alt', 'Shift', 'Cmd']

// canonical form for comparing two accelerators for conflicts
export function normalizeAccelerator(accel: string, isMac: boolean): string {
  const parts = accel.split('+').map((p) => p.trim())
  const mods: string[] = []
  let key = ''
  for (const raw of parts) {
    const p = raw.toLowerCase()
    if (p === 'cmdorctrl' || p === 'commandorcontrol') mods.push(isMac ? 'Cmd' : 'Control')
    else if (p === 'cmd' || p === 'command' || p === 'super' || p === 'meta') mods.push('Cmd')
    else if (p === 'control' || p === 'ctrl') mods.push('Control')
    else if (p === 'alt' || p === 'option' || p === 'altgr') mods.push('Alt')
    else if (p === 'shift') mods.push('Shift')
    else key = raw.length === 1 ? raw.toUpperCase() : raw[0]!.toUpperCase() + raw.slice(1)
  }
  const ordered = MOD_ORDER.filter((m) => mods.includes(m))
  return [...ordered, key].join('+')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/accelerator.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/accelerator.ts tests/accelerator.test.ts
git commit -m "feat: accelerator recording and normalization helpers"
```

---

### Task 8: Shortcuts IPC surface + validation

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: Task 1's `SHORTCUT_COMMANDS`/`FIXED_SHORTCUTS`, Task 2's
  `ShortcutsStore`, Task 5's `rebuildMenu`, Task 7's `normalizeAccelerator`.
- Produces: `ShortcutRow { id: string; label: string; accelerator: string;
  default: string; fixed: boolean }` (exported from `src/shared/ipc.ts`);
  `SynapseApi.shortcuts` with
  `list(): Promise<ShortcutRow[]>`,
  `set(id: string, accelerator: string): Promise<{ ok: boolean; error?: string }>`,
  `reset(id: string): Promise<void>`, `resetAll(): Promise<void>`.
  Channels: `shortcuts:list`, `shortcuts:set`, `shortcuts:reset`,
  `shortcuts:reset-all`.

- [ ] **Step 1: Shared types**

In `src/shared/ipc.ts` add near the other interfaces:

```typescript
export interface ShortcutRow {
  id: string
  label: string
  accelerator: string
  default: string
  fixed: boolean
}
```

And to `SynapseApi` (after the `downloads` block):

```typescript
shortcuts: {
  list(): Promise<ShortcutRow[]>
  set(id: string, accelerator: string): Promise<{ ok: boolean; error?: string }>
  reset(id: string): Promise<void>
  resetAll(): Promise<void>
}
```

- [ ] **Step 2: Preload**

In `src/preload/index.ts` api object, after `downloads`:

```typescript
shortcuts: {
  list: () => ipcRenderer.invoke('shortcuts:list'),
  set: (id, accelerator) => ipcRenderer.invoke('shortcuts:set', id, accelerator),
  reset: (id) => ipcRenderer.invoke('shortcuts:reset', id),
  resetAll: () => ipcRenderer.invoke('shortcuts:reset-all'),
},
```

- [ ] **Step 3: Main handlers**

In `src/main/index.ts` add imports:
`SHORTCUT_COMMANDS, FIXED_SHORTCUTS` from `../shared/shortcuts`,
`normalizeAccelerator` from `../shared/accelerator`,
`ShortcutRow` (type) from `../shared/ipc`.

After the `rebuildMenu()` wiring add:

```typescript
const isMac = process.platform === 'darwin'
ipcMain.handle('shortcuts:list', (): ShortcutRow[] => {
  const resolved = shortcutsStore.resolved()
  return [
    ...SHORTCUT_COMMANDS.map((c) => ({
      id: c.id,
      label: c.label,
      accelerator: resolved[c.id]!,
      default: c.default,
      fixed: false,
    })),
    ...FIXED_SHORTCUTS.map((f) => ({
      id: f.id,
      label: f.label,
      accelerator: f.accelerator,
      default: f.accelerator,
      fixed: true,
    })),
  ]
})
ipcMain.handle('shortcuts:set', (_e, id: string, accelerator: string) => {
  if (typeof id !== 'string' || typeof accelerator !== 'string' || !accelerator) {
    return { ok: false, error: 'Invalid shortcut.' }
  }
  const command = SHORTCUT_COMMANDS.find((c) => c.id === id)
  if (!command) return { ok: false, error: 'Unknown command.' }
  const wanted = normalizeAccelerator(accelerator, isMac)
  const resolved = shortcutsStore.resolved()
  for (const other of SHORTCUT_COMMANDS) {
    if (other.id !== id && normalizeAccelerator(resolved[other.id]!, isMac) === wanted) {
      return { ok: false, error: `Already used by “${other.label}”.` }
    }
  }
  shortcutsStore.set(id, accelerator)
  rebuildMenu()
  return { ok: true }
})
ipcMain.handle('shortcuts:reset', (_e, id: string) => {
  if (typeof id === 'string') {
    shortcutsStore.reset(id)
    rebuildMenu()
  }
})
ipcMain.handle('shortcuts:reset-all', () => {
  shortcutsStore.resetAll()
  rebuildMenu()
})
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "feat: shortcuts list/set/reset IPC with conflict validation"
```

---

### Task 9: Keyboard Shortcuts settings view (#5)

**Files:**
- Modify: `src/renderer/settings.ts`
- Modify: `src/renderer/style.css`

**Interfaces:**
- Consumes: Task 6's `renderSettings` scaffold (replaces its placeholder
  `renderShortcutsSection`), Task 7's `acceleratorFromKeyEvent`, Task 8's
  `window.synapse.shortcuts`.
- Produces: the finished shortcuts settings UI; nothing downstream.

- [ ] **Step 1: Replace the placeholder section**

In `src/renderer/settings.ts`, add imports at the top:

```typescript
import { acceleratorFromKeyEvent } from '../shared/accelerator'
import type { ShortcutRow } from '../shared/ipc'
```

Replace the placeholder `renderShortcutsSection` with:

```typescript
function renderShortcutsSection(body: HTMLElement): void {
  const toolbar = document.createElement('div')
  toolbar.className = 'settings-toolbar'
  const resetAll = document.createElement('button')
  resetAll.className = 'settings-action'
  resetAll.textContent = 'Reset All'
  resetAll.addEventListener('click', () => {
    void window.synapse.shortcuts.resetAll().then(() => refresh())
  })
  toolbar.append(resetAll)

  const list = document.createElement('div')
  list.id = 'shortcut-list'
  body.append(toolbar, list)

  const refresh = (): void => {
    void window.synapse.shortcuts.list().then((rows) => renderRows(list, rows, refresh))
  }
  refresh()
}

function renderRows(list: HTMLElement, rows: ShortcutRow[], refresh: () => void): void {
  list.innerHTML = ''
  for (const row of rows) {
    const item = document.createElement('div')
    item.className = 'shortcut-row'

    const label = document.createElement('span')
    label.className = 'shortcut-label'
    label.textContent = row.label

    const chip = document.createElement('button')
    chip.className = 'shortcut-chip' + (row.fixed ? ' fixed' : '')
    chip.textContent = row.accelerator
    chip.disabled = row.fixed
    if (row.fixed) chip.title = 'This shortcut is built in and cannot be changed'

    const error = document.createElement('span')
    error.className = 'shortcut-error'

    item.append(label, chip, error)

    if (!row.fixed) {
      if (row.accelerator !== row.default) {
        const reset = document.createElement('button')
        reset.className = 'settings-action'
        reset.textContent = 'Reset'
        reset.title = `Reset to ${row.default}`
        reset.addEventListener('click', () => {
          void window.synapse.shortcuts.reset(row.id).then(() => refresh())
        })
        item.append(reset)
      }
      chip.addEventListener('click', () => beginRecording(chip, error, row.id, refresh))
    }
    list.append(item)
  }
}

function beginRecording(
  chip: HTMLButtonElement,
  error: HTMLElement,
  id: string,
  refresh: () => void,
): void {
  chip.classList.add('recording')
  chip.textContent = 'Press shortcut…'
  error.textContent = ''
  const onKey = (e: KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      cleanup()
      refresh()
      return
    }
    const accel = acceleratorFromKeyEvent(e)
    if (!accel) return // ignore bare modifiers; keep recording
    cleanup()
    void window.synapse.shortcuts.set(id, accel).then((result) => {
      if (!result.ok) error.textContent = result.error ?? 'Could not set shortcut.'
      refresh()
    })
  }
  const cleanup = (): void => {
    window.removeEventListener('keydown', onKey, true)
    chip.classList.remove('recording')
  }
  window.addEventListener('keydown', onKey, true)
}
```

- [ ] **Step 2: CSS**

Append to `src/renderer/style.css`:

```css
.settings-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.settings-action {
  background: none;
  border: none;
  color: var(--fg-dim);
  font-size: 12px;
  border-radius: 4px;
  padding: 3px 8px;
  cursor: pointer;
}
.settings-action:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--fg);
}
#shortcut-list {
  display: flex;
  flex-direction: column;
}
.shortcut-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 8px;
}
.shortcut-row:hover {
  background: rgba(255, 255, 255, 0.04);
}
.shortcut-label {
  flex: 1;
}
.shortcut-chip {
  background: var(--bg-raised);
  border: 1px solid transparent;
  color: var(--fg);
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12px;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
.shortcut-chip:hover:not(:disabled) {
  border-color: var(--accent);
}
.shortcut-chip.recording {
  border-color: var(--accent);
  color: var(--accent);
}
.shortcut-chip.fixed {
  color: var(--fg-dim);
  cursor: default;
}
.shortcut-error {
  color: #f7768e;
  font-size: 12px;
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/settings.ts src/renderer/style.css
git commit -m "feat: keyboard shortcuts settings with chord recording"
```

---

### Task 10: Bookmarks IO helpers (shared)

**Files:**
- Create: `src/shared/bookmarks-io.ts`
- Test: `tests/bookmarks-io.test.ts`

**Interfaces:**
- Consumes: `BookmarksData`, `Bookmark`, `BookmarkFolder`, `ProfileId` types from `src/shared/ipc.ts`.
- Produces:
  `parseBookmarksExport(text: string): BookmarksData | null`;
  `ImportPlan { folders: string[]; bookmarks: Array<{ url: string; title: string; profile: ProfileId; folderName: string | null }>; skipped: number }`;
  `planImport(existing: BookmarksData, incoming: BookmarksData): ImportPlan`.

- [ ] **Step 1: Write the failing test**

Create `tests/bookmarks-io.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import type { BookmarksData } from '../src/shared/ipc'
import { parseBookmarksExport, planImport } from '../src/shared/bookmarks-io'

const data = (over: Partial<BookmarksData> = {}): BookmarksData => ({
  folders: [],
  bookmarks: [],
  ...over,
})

const bm = (id: string, url: string, over: Record<string, unknown> = {}) => ({
  id,
  url,
  title: url,
  createdAt: 1,
  ...over,
})

describe('parseBookmarksExport', () => {
  it('accepts a valid export', () => {
    const text = JSON.stringify({
      v: 1,
      folders: [{ id: 'f1', name: 'Work' }],
      bookmarks: [bm('b1', 'https://a.com', { folderId: 'f1', profile: 'work' })],
    })
    const parsed = parseBookmarksExport(text)
    expect(parsed?.folders).toHaveLength(1)
    expect(parsed?.bookmarks[0]?.url).toBe('https://a.com')
    expect(parsed?.bookmarks[0]?.profile).toBe('work')
  })

  it('rejects malformed JSON, wrong version, and non-object shapes', () => {
    expect(parseBookmarksExport('{nope')).toBeNull()
    expect(parseBookmarksExport(JSON.stringify({ v: 2, folders: [], bookmarks: [] }))).toBeNull()
    expect(parseBookmarksExport(JSON.stringify([]))).toBeNull()
  })

  it('skips invalid items but keeps valid ones', () => {
    const text = JSON.stringify({
      v: 1,
      folders: [{ id: 'f1', name: 'Ok' }, { id: 'f2' }, 'junk'],
      bookmarks: [bm('b1', 'https://a.com'), { id: 'b2' }, 42],
    })
    const parsed = parseBookmarksExport(text)
    expect(parsed?.folders).toHaveLength(1)
    expect(parsed?.bookmarks).toHaveLength(1)
  })
})

describe('planImport', () => {
  it('creates missing folders and resolves bookmark folder names', () => {
    const incoming = data({
      folders: [{ id: 'f1', name: 'Work' }],
      bookmarks: [bm('b1', 'https://a.com', { folderId: 'f1' })],
    })
    const plan = planImport(data(), incoming)
    expect(plan.folders).toEqual(['Work'])
    expect(plan.bookmarks).toEqual([
      { url: 'https://a.com', title: 'https://a.com', profile: 'default', folderName: 'Work' },
    ])
    expect(plan.skipped).toBe(0)
  })

  it('matches existing folders by name instead of recreating', () => {
    const existing = data({ folders: [{ id: 'x', name: 'Work' }] })
    const incoming = data({
      folders: [{ id: 'f1', name: 'Work' }],
      bookmarks: [bm('b1', 'https://a.com', { folderId: 'f1' })],
    })
    const plan = planImport(existing, incoming)
    expect(plan.folders).toEqual([])
    expect(plan.bookmarks[0]?.folderName).toBe('Work')
  })

  it('skips duplicates against existing and within the import', () => {
    const existing = data({ bookmarks: [bm('e1', 'https://a.com')] })
    const incoming = data({
      bookmarks: [bm('b1', 'https://a.com'), bm('b2', 'https://a.com'), bm('b3', 'https://b.com')],
    })
    const plan = planImport(existing, incoming)
    expect(plan.bookmarks.map((b) => b.url)).toEqual(['https://b.com'])
    expect(plan.skipped).toBe(2)
  })

  it('treats same url in different folders as distinct', () => {
    const incoming = data({
      folders: [{ id: 'f1', name: 'Work' }],
      bookmarks: [bm('b1', 'https://a.com'), bm('b2', 'https://a.com', { folderId: 'f1' })],
    })
    const plan = planImport(data(), incoming)
    expect(plan.bookmarks).toHaveLength(2)
  })

  it('drops bookmarks pointing at unknown folder ids to top level', () => {
    const incoming = data({ bookmarks: [bm('b1', 'https://a.com', { folderId: 'ghost' })] })
    const plan = planImport(data(), incoming)
    expect(plan.bookmarks[0]?.folderName).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bookmarks-io.test.ts`
Expected: FAIL — cannot resolve `../src/shared/bookmarks-io`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/bookmarks-io.ts`:

```typescript
import type { Bookmark, BookmarkFolder, BookmarksData, ProfileId } from './ipc'

// parse + validate an export file: { v: 1, folders, bookmarks }; invalid
// items are skipped, anything structurally wrong returns null
export function parseBookmarksExport(text: string): BookmarksData | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (obj['v'] !== 1 || !Array.isArray(obj['folders']) || !Array.isArray(obj['bookmarks'])) {
    return null
  }
  const folders: BookmarkFolder[] = []
  for (const f of obj['folders']) {
    if (f && typeof f === 'object' && typeof (f as BookmarkFolder).id === 'string' &&
        typeof (f as BookmarkFolder).name === 'string') {
      folders.push({ id: (f as BookmarkFolder).id, name: (f as BookmarkFolder).name })
    }
  }
  const bookmarks: Bookmark[] = []
  for (const b of obj['bookmarks']) {
    if (!b || typeof b !== 'object') continue
    const cand = b as Record<string, unknown>
    if (typeof cand['id'] !== 'string' || typeof cand['url'] !== 'string' ||
        typeof cand['title'] !== 'string') continue
    bookmarks.push({
      id: cand['id'],
      url: cand['url'],
      title: cand['title'],
      createdAt: typeof cand['createdAt'] === 'number' ? cand['createdAt'] : 0,
      ...(typeof cand['folderId'] === 'string' ? { folderId: cand['folderId'] } : {}),
      ...(cand['profile'] === 'work' ? { profile: 'work' as ProfileId } : {}),
    })
  }
  return { folders, bookmarks }
}

export interface ImportPlan {
  folders: string[]
  bookmarks: Array<{ url: string; title: string; profile: ProfileId; folderName: string | null }>
  skipped: number
}

// folders are matched by name; bookmarks dedupe by (url, target folder name)
// against both the existing data and earlier items in the same import
export function planImport(existing: BookmarksData, incoming: BookmarksData): ImportPlan {
  const incomingFolderName = new Map(incoming.folders.map((f) => [f.id, f.name]))
  const existingFolderName = new Map(existing.folders.map((f) => [f.id, f.name]))
  const existingNames = new Set(existing.folders.map((f) => f.name))

  const seen = new Set(
    existing.bookmarks.map(
      (b) => `${b.url} ${(b.folderId && existingFolderName.get(b.folderId)) ?? ''}`,
    ),
  )

  const folders: string[] = []
  const neededFolders = new Set<string>()
  const bookmarks: ImportPlan['bookmarks'] = []
  let skipped = 0

  for (const b of incoming.bookmarks) {
    const folderName = (b.folderId && incomingFolderName.get(b.folderId)) || null
    const key = `${b.url} ${folderName ?? ''}`
    if (seen.has(key)) {
      skipped += 1
      continue
    }
    seen.add(key)
    if (folderName) neededFolders.add(folderName)
    bookmarks.push({
      url: b.url,
      title: b.title,
      profile: b.profile === 'work' ? 'work' : 'default',
      folderName,
    })
  }

  for (const name of neededFolders) {
    if (!existingNames.has(name)) folders.push(name)
  }

  return { folders, bookmarks, skipped }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bookmarks-io.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/bookmarks-io.ts tests/bookmarks-io.test.ts
git commit -m "feat: bookmarks export parsing and import planning"
```

---

### Task 11: Export/import wiring (#11)

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: Task 10's `parseBookmarksExport`/`planImport`; Task 5's
  `MenuCommands.exportBookmarks/importBookmarks` placeholder slots; existing
  `BookmarksStore` (`list()`, `add(url, title, createdAt, profile)`,
  `addFolder(name)`, `moveToFolder(id, folderId)`), `bookmarksChanged()`.
- Produces: working File → Export/Import Bookmarks.

- [ ] **Step 1: Implement the two commands**

In `src/main/index.ts` add imports: `parseBookmarksExport, planImport` from
`../shared/bookmarks-io`, and `readFileSync, writeFileSync` added to the
existing `node:fs` import.

After the `toggleBookmark` definition add:

```typescript
const exportBookmarks = async (): Promise<void> => {
  const date = new Date().toISOString().slice(0, 10)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `synapse-bookmarks-${date}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (canceled || !filePath) return
  writeFileSync(filePath, JSON.stringify({ v: 1, ...bookmarks.list() }, null, 2))
}

const importBookmarks = async (): Promise<void> => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (canceled || !filePaths[0]) return
  let text: string
  try {
    text = readFileSync(filePaths[0], 'utf8')
  } catch {
    void dialog.showMessageBox(win, { type: 'error', message: 'Could not read that file.' })
    return
  }
  const incoming = parseBookmarksExport(text)
  if (!incoming) {
    void dialog.showMessageBox(win, {
      type: 'error',
      message: 'Not a Synapse bookmarks export file.',
    })
    return
  }
  const plan = planImport(bookmarks.list(), incoming)
  const folderIds = new Map(bookmarks.list().folders.map((f) => [f.name, f.id]))
  for (const name of plan.folders) folderIds.set(name, bookmarks.addFolder(name).id)
  for (const item of plan.bookmarks) {
    const created = bookmarks.add(item.url, item.title, Date.now(), item.profile)
    if (item.folderName) {
      const fid = folderIds.get(item.folderName)
      if (fid) bookmarks.moveToFolder(created.id, fid)
    }
  }
  bookmarksChanged()
  const n = plan.bookmarks.length
  void dialog.showMessageBox(win, {
    type: 'info',
    message: `Imported ${n} bookmark${n === 1 ? '' : 's'}${
      plan.skipped ? ` (${plan.skipped} skipped as duplicates)` : ''
    }.`,
  })
}
```

In `rebuildMenu`, replace the two placeholders:

```typescript
exportBookmarks: () => void exportBookmarks(),
importBookmarks: () => void importBookmarks(),
```

NOTE: `rebuildMenu`/`bookmarksChanged` ordering — `bookmarksChanged` is
declared with `const` later in the file than `rebuildMenu`. Define
`exportBookmarks`/`importBookmarks` AFTER `bookmarksChanged` (both are only
invoked from menu clicks, long after startup, so the `rebuildMenu` closure
referencing them must also be declared after — move the `rebuildMenu` block
below `bookmarksChanged` if it isn't already; menu construction happens at the
`rebuildMenu()` call, keep that call where the old `buildMenu(...)` call was).

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: bookmarks JSON export and import via File menu"
```

---

### Task 12: Verification sweep

**Files:**
- Modify: none expected (fix anything found).

- [ ] **Step 1: Full checks**

Run: `npm run typecheck && npm test && npm run build`
Expected: all clean.

- [ ] **Step 2: Boot check**

Run the app (`npm run dev`, backgrounded, with output redirected) and confirm
from logs that it boots without main-process errors, then quit it.

- [ ] **Step 3: Commit (only if fixes were needed)**

```bash
git add -A && git commit -m "fix: issue-batch verification fixes"
```
