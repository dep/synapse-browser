# Resizable Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag handle on the sidebar's right edge resizes it between 180–480px, page view tracks live, width persists across restarts.

**Architecture:** The chrome renderer only initiates the drag and renders width pushes; main tracks the cursor by polling (`screen.getCursorScreenPoint()` at ~60Hz) because `WebContentsView`s swallow mouse events above the chrome renderer. Main clamps via a shared Electron-free helper, relayouts the page view directly, pushes `ui:sidebar-width` to the renderer, and persists to a `JsonStore`-backed `ui.json` on drag end.

**Tech Stack:** Electron 43, TypeScript strict, Vitest, no UI framework, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-08-resizable-sidebar-design.md`

## Global Constraints

- TypeScript strict; `npm run typecheck` must pass before any task is called done.
- No new npm dependencies.
- Pure logic goes in Electron-free modules (`src/shared/`) with Vitest coverage in `tests/`.
- Short conventional commits (`feat:`, `fix:`, `chore:`).
- Width bounds are exactly: min 180, max 480, default 240 (from the spec).
- IPC channel names are exactly: `ui:sidebar-drag-start`, `ui:sidebar-drag-end`, `ui:sidebar-width`.

---

### Task 1: Shared clamp helper

**Files:**
- Create: `src/shared/sidebar-width.ts`
- Test: `tests/sidebar-width.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SIDEBAR_WIDTH_DEFAULT = 240`, `SIDEBAR_WIDTH_MIN = 180`, `SIDEBAR_WIDTH_MAX = 480` (all `number`), and `clampSidebarWidth(px: number): number`. Tasks 2, 3, and 5 import these.

- [ ] **Step 1: Write the failing test**

Create `tests/sidebar-width.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  clampSidebarWidth,
} from '../src/shared/sidebar-width'

describe('clampSidebarWidth', () => {
  it('passes through in-range widths, rounded to whole pixels', () => {
    expect(clampSidebarWidth(300)).toBe(300)
    expect(clampSidebarWidth(300.6)).toBe(301)
  })

  it('clamps below the minimum', () => {
    expect(clampSidebarWidth(0)).toBe(SIDEBAR_WIDTH_MIN)
    expect(clampSidebarWidth(-50)).toBe(SIDEBAR_WIDTH_MIN)
  })

  it('clamps above the maximum', () => {
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_WIDTH_MAX)
  })

  it('maps non-finite input to the default', () => {
    expect(clampSidebarWidth(NaN)).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(clampSidebarWidth(Infinity)).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  it('keeps the default inside the range', () => {
    expect(SIDEBAR_WIDTH_DEFAULT).toBeGreaterThanOrEqual(SIDEBAR_WIDTH_MIN)
    expect(SIDEBAR_WIDTH_DEFAULT).toBeLessThanOrEqual(SIDEBAR_WIDTH_MAX)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sidebar-width.test.ts`
Expected: FAIL — cannot resolve `../src/shared/sidebar-width`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/sidebar-width.ts`:

```typescript
export const SIDEBAR_WIDTH_DEFAULT = 240
export const SIDEBAR_WIDTH_MIN = 180
export const SIDEBAR_WIDTH_MAX = 480

export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return SIDEBAR_WIDTH_DEFAULT
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(px)))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sidebar-width.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/sidebar-width.ts tests/sidebar-width.test.ts
git commit -m "feat: shared sidebar width bounds + clamp helper"
```

---

### Task 2: UiStore (persistence)

**Files:**
- Create: `src/main/ui-store.ts`
- Test: `tests/ui-store.test.ts`

**Interfaces:**
- Consumes: `JsonStore` from `src/main/store.ts` (existing: `new JsonStore<T>(filePath, fallback)`, `.get(): T`, `.set(data: T)`, `.flush()`); Task 1's `clampSidebarWidth`, `SIDEBAR_WIDTH_DEFAULT`.
- Produces: `class UiStore` with `constructor(dir: string)`, `sidebarWidth(): number`, `setSidebarWidth(px: number): void`, `flush(): void`. Task 5 uses all four.

- [ ] **Step 1: Write the failing test**

Create `tests/ui-store.test.ts` (mirrors the tmp-dir pattern of `tests/store.test.ts`):

```typescript
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UiStore } from '../src/main/ui-store'

describe('UiStore', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uistore-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('defaults to 240 when no file exists', () => {
    expect(new UiStore(dir).sidebarWidth()).toBe(240)
  })

  it('round-trips a width through disk', () => {
    const store = new UiStore(dir)
    store.setSidebarWidth(320)
    store.flush()
    expect(new UiStore(dir).sidebarWidth()).toBe(320)
  })

  it('clamps out-of-range stored values on read', () => {
    fs.writeFileSync(path.join(dir, 'ui.json'), JSON.stringify({ v: 1, sidebarWidth: 9999 }))
    expect(new UiStore(dir).sidebarWidth()).toBe(480)
  })

  it('clamps on write', () => {
    const store = new UiStore(dir)
    store.setSidebarWidth(10)
    expect(store.sidebarWidth()).toBe(180)
  })

  it('falls back to the default on non-numeric stored value', () => {
    fs.writeFileSync(path.join(dir, 'ui.json'), JSON.stringify({ v: 1, sidebarWidth: 'wide' }))
    expect(new UiStore(dir).sidebarWidth()).toBe(240)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui-store.test.ts`
Expected: FAIL — cannot resolve `../src/main/ui-store`.

- [ ] **Step 3: Write the implementation**

Create `src/main/ui-store.ts` (same shape as `src/main/pins-store.ts`):

```typescript
import * as path from 'node:path'
import { SIDEBAR_WIDTH_DEFAULT, clampSidebarWidth } from '../shared/sidebar-width'
import { JsonStore } from './store'

interface UiFile {
  v: 1
  sidebarWidth: number
}

export class UiStore {
  private store: JsonStore<UiFile>

  constructor(dir: string) {
    this.store = new JsonStore<UiFile>(path.join(dir, 'ui.json'), {
      v: 1,
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    })
  }

  // clamp on read too: the file is user-editable and may carry garbage
  sidebarWidth(): number {
    return clampSidebarWidth(this.store.get().sidebarWidth)
  }

  setSidebarWidth(px: number): void {
    this.store.set({ v: 1, sidebarWidth: clampSidebarWidth(px) })
  }

  flush(): void {
    this.store.flush()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/ui-store.ts tests/ui-store.test.ts
git commit -m "feat: ui.json store persisting sidebar width"
```

---

### Task 3: TabManager takes a variable sidebar width

**Files:**
- Modify: `src/main/tab-manager.ts` (lines 7, 26–29 area, ~403, ~474–484)

**Interfaces:**
- Consumes: Task 1's `SIDEBAR_WIDTH_DEFAULT`, `clampSidebarWidth`.
- Produces: `TabManager.setSidebarWidth(px: number): void` — clamps and relayouts. Task 5 calls it. The exported `SIDEBAR_WIDTH` const is deleted (verified: no other file imports it).

- [ ] **Step 1: Replace the const with a field and setter**

In `src/main/tab-manager.ts`, delete line 7:

```typescript
export const SIDEBAR_WIDTH = 240
```

Add to the imports at the top:

```typescript
import { SIDEBAR_WIDTH_DEFAULT, clampSidebarWidth } from '../shared/sidebar-width'
```

Next to the existing `private overlayHeight = 0` field, add:

```typescript
private sidebarWidth = SIDEBAR_WIDTH_DEFAULT
```

Next to the existing `setOverlayHeight` method (~line 403), add:

```typescript
setSidebarWidth(px: number): void {
  this.sidebarWidth = clampSidebarWidth(px)
  this.layout()
}
```

In `layout()` (~line 474), replace both `SIDEBAR_WIDTH` references:

```typescript
private layout(): void {
  if (!this.attached) return
  const [w, h] = this.win.getContentSize()
  const top = TOPBAR_HEIGHT + this.overlayHeight
  this.attached.setBounds({
    x: this.sidebarWidth,
    y: top,
    width: Math.max(0, w - this.sidebarWidth),
    height: Math.max(0, h - top),
  })
}
```

- [ ] **Step 2: Verify typecheck and existing tests still pass**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all existing Vitest suites PASS (tab-manager has no unit tests — it's Electron-coupled, verified by smoke in Task 6).

- [ ] **Step 3: Commit**

```bash
git add src/main/tab-manager.ts
git commit -m "feat: tab-manager sidebar width is a settable field"
```

---

### Task 4: IPC surface (shared types + preload)

**Files:**
- Modify: `src/shared/ipc.ts:102-109` (the `ui` block of `SynapseApi`)
- Modify: `src/preload/index.ts:46-63` (the `ui` block of the preload api)

**Interfaces:**
- Consumes: nothing new.
- Produces: `window.synapse.ui.startSidebarDrag(): void`, `endSidebarDrag(): void`, `onSidebarWidth(cb: (px: number) => void): void` over channels `ui:sidebar-drag-start`, `ui:sidebar-drag-end`, `ui:sidebar-width`. Task 5 handles/sends the channels in main; Task 6 calls the api in the renderer.

- [ ] **Step 1: Extend `SynapseApi`**

In `src/shared/ipc.ts`, inside the `ui:` block, after `setOverlayHeight(px: number): void` add:

```typescript
startSidebarDrag(): void
endSidebarDrag(): void
onSidebarWidth(cb: (px: number) => void): void
```

- [ ] **Step 2: Wire the preload**

In `src/preload/index.ts`, inside the `ui:` object, after the `setOverlayHeight` line add:

```typescript
startSidebarDrag: () => ipcRenderer.send('ui:sidebar-drag-start'),
endSidebarDrag: () => ipcRenderer.send('ui:sidebar-drag-end'),
onSidebarWidth: (cb) => {
  ipcRenderer.on('ui:sidebar-width', (_e, px) => cb(px))
},
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: clean (the interface and the preload object must agree or `const api: SynapseApi` errors).

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts
git commit -m "feat: sidebar resize IPC surface"
```

---

### Task 5: Main-side drag controller + wiring

**Files:**
- Create: `src/main/sidebar-resize.ts`
- Modify: `src/main/index.ts` (imports; store setup ~line 61; after the `TabManager` construction ~line 147; the `ui:set-overlay-height` handler area ~line 415; `did-finish-load` ~line 417; `before-quit` ~line 435)

**Interfaces:**
- Consumes: Task 1's `clampSidebarWidth`; Task 2's `UiStore`; Task 3's `tabs.setSidebarWidth(px)`; existing `tabs.activeId: string | null` and `tabs.webContentsFor(id: string): WebContents | null`; channels from Task 4.
- Produces: `class SidebarResizeController` with `constructor(opts: SidebarResizeOptions, initialWidth: number)`, `start(): void`, `end(): void`, `get current(): number`. Task 6 relies on main pushing `ui:sidebar-width` on boot and during drags.

- [ ] **Step 1: Write the controller**

Create `src/main/sidebar-resize.ts`:

```typescript
import { screen } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { clampSidebarWidth } from '../shared/sidebar-width'

export interface SidebarResizeOptions {
  win: BrowserWindow
  getPageWebContents(): WebContents | null
  onWidth(px: number): void
  onCommit(px: number): void
}

// Mouse events over a WebContentsView never reach the chrome renderer —
// native views draw and hit-test above the window's own web contents — so
// once the cursor crosses into the page a renderer-tracked drag stalls.
// The renderer therefore only initiates; main tracks the cursor by polling.
export class SidebarResizeController {
  private timer: ReturnType<typeof setInterval> | null = null
  private tracked: WebContents[] = []
  private width: number

  constructor(
    private opts: SidebarResizeOptions,
    initialWidth: number,
  ) {
    this.width = clampSidebarWidth(initialWidth)
    // a release outside the window delivers no mouseUp to any of our surfaces
    opts.win.on('blur', () => this.end())
  }

  get current(): number {
    return this.width
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.track(), 16)
    // watch both surfaces for the release: chrome UI (cursor over sidebar /
    // topbar) and the active page view (cursor over the page)
    for (const wc of [this.opts.win.webContents, this.opts.getPageWebContents()]) {
      if (!wc || wc.isDestroyed()) continue
      wc.on('input-event', this.onInputEvent)
      this.tracked.push(wc)
    }
  }

  end(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    for (const wc of this.tracked) {
      if (!wc.isDestroyed()) wc.removeListener('input-event', this.onInputEvent)
    }
    this.tracked = []
    this.opts.onCommit(this.width)
  }

  private onInputEvent = (_e: Electron.Event, input: Electron.InputEvent): void => {
    // a move without the left button means the mouseUp happened where we
    // couldn't see it (e.g. outside the window) — treat it as the release
    const released =
      input.type === 'mouseUp' ||
      (input.type === 'mouseMove' && !(input.modifiers ?? []).includes('leftButtonDown'))
    if (released) this.end()
  }

  private track(): void {
    const cursorX = screen.getCursorScreenPoint().x
    const contentLeft = this.opts.win.getContentBounds().x
    this.width = clampSidebarWidth(cursorX - contentLeft)
    this.opts.onWidth(this.width)
  }
}
```

- [ ] **Step 2: Wire it in `src/main/index.ts`**

Add to the imports:

```typescript
import { SidebarResizeController } from './sidebar-resize'
import { UiStore } from './ui-store'
```

Next to the other store constructions (after `const pinsStore = new PinsStore(userData)`):

```typescript
const uiStore = new UiStore(userData)
```

After `const extensions = new ExtensionManager(win, tabs)` (the `tabs` binding must exist):

```typescript
tabs.setSidebarWidth(uiStore.sidebarWidth())
const sidebarResize = new SidebarResizeController(
  {
    win,
    getPageWebContents: () => (tabs.activeId ? tabs.webContentsFor(tabs.activeId) : null),
    onWidth: (px) => {
      tabs.setSidebarWidth(px)
      win.webContents.send('ui:sidebar-width', px)
    },
    onCommit: (px) => uiStore.setSidebarWidth(px),
  },
  uiStore.sidebarWidth(),
)
```

Next to the existing `ui:set-overlay-height` handler (~line 415):

```typescript
ipcMain.on('ui:sidebar-drag-start', () => sidebarResize.start())
ipcMain.on('ui:sidebar-drag-end', () => sidebarResize.end())
```

Replace the `did-finish-load` line (~417) so boot also pushes the stored width (covers reload too):

```typescript
win.webContents.on('did-finish-load', () => {
  tabs.refresh()
  win.webContents.send('ui:sidebar-width', sidebarResize.current)
})
```

In the `before-quit` handler, add alongside the other flushes:

```typescript
uiStore.flush()
```

- [ ] **Step 3: Verify typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: both clean. (The controller is Electron-coupled — polling and `input-event` behavior are covered by manual smoke in Task 6.)

- [ ] **Step 4: Commit**

```bash
git add src/main/sidebar-resize.ts src/main/index.ts
git commit -m "feat: main-side sidebar drag controller with cursor polling"
```

---

### Task 6: Renderer handle + smoke test

**Files:**
- Modify: `src/renderer/index.html` (inside `#app`, after `</aside>`)
- Modify: `src/renderer/style.css` (new rules at the end)
- Modify: `src/renderer/main.ts` (element refs ~line 11; wiring after the `onTabsUpdated` block)

**Interfaces:**
- Consumes: Task 4's `window.synapse.ui.startSidebarDrag/endSidebarDrag/onSidebarWidth`; Task 5's `ui:sidebar-width` pushes (boot + during drag).
- Produces: the visible feature; nothing downstream.

- [ ] **Step 1: Add the handle element**

In `src/renderer/index.html`, after `</aside>` and before the closing `</div>` of `#app`:

```html
<div id="sidebar-resize"></div>
```

- [ ] **Step 2: Style it**

Append to `src/renderer/style.css`:

```css
#sidebar-resize {
  /* 5px grab strip straddling the sidebar edge; left is kept in sync with
     the sidebar width by main.ts */
  position: fixed;
  top: 52px;
  bottom: 0;
  left: 238px;
  width: 5px;
  cursor: col-resize;
  z-index: 10;
}
#sidebar-resize::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 1px;
  background: transparent;
}
#sidebar-resize:hover::after,
#sidebar-resize:active::after {
  background: var(--accent);
}
```

- [ ] **Step 3: Wire the renderer**

In `src/renderer/main.ts`, add element refs next to the existing ones:

```typescript
const appEl = document.getElementById('app')!
const sidebarResizeEl = document.getElementById('sidebar-resize')!
```

After the `window.synapse.onTabsUpdated(...)` block, add:

```typescript
// width is owned by main (it must position the page view); the renderer
// only initiates drags and renders pushed widths
window.synapse.ui.onSidebarWidth((px) => {
  appEl.style.gridTemplateColumns = `${px}px 1fr`
  sidebarResizeEl.style.left = `${px - 2}px`
})
sidebarResizeEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  e.preventDefault()
  window.synapse.ui.startSidebarDrag()
})
// belt-and-braces alongside main's input-event/blur detection; main's
// end() no-ops when no drag is active
window.addEventListener('mouseup', () => window.synapse.ui.endSidebarDrag())
```

- [ ] **Step 4: Typecheck + unit tests**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`, then verify each:

1. Hover the sidebar's right edge → `col-resize` cursor and a 1px accent line.
2. Slow drag right/left → sidebar and page view track together; clamps at 180 and 480.
3. Fast flick deep into the page area → tracking continues (main polls; no stall).
4. Release while the cursor is over the page → drag ends (no stuck resizing on later mouse moves).
5. Release outside the window (drag past the right screen edge of the window, release) → next interaction shows the drag ended.
6. Open the URL-bar suggestions dropdown after resizing → page still shifts down correctly (overlay axis unaffected).
7. Activate a Work-profile tab, drag again → still tracks and ends cleanly.
8. Quit and relaunch → width restored; `ui.json` in userData contains `{ "v": 1, "sidebarWidth": <n> }`.

Expected: all 8 pass. If dev-server output seems empty, remember rtk buffers it (`ELECTRON_ENABLE_LOGGING=1 rtk proxy npm run dev` with a redirect).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/index.html src/renderer/style.css src/renderer/main.ts
git commit -m "feat: draggable sidebar resize handle"
```
