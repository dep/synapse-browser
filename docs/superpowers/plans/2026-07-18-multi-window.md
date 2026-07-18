# Multi-Window Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cmd+N spawns an ephemeral secondary window; a tab dragged out of the sidebar detaches into its own secondary window (issue #26).

**Architecture:** Extract the single-window wiring trapped in `app.whenReady()` into a `createWindow(role)` factory producing per-window bundles (win + TabManager + SuggestionsOverlay + resize controllers), tracked in a registry. IPC handlers resolve the sender's bundle instead of closing over one `win`. Secondary windows are ephemeral: no persistence, no pins/bookmarks/AI in their chrome. Spec: `docs/superpowers/specs/2026-07-18-multi-window-design.md`.

**Tech Stack:** Electron 43, TypeScript strict, Vitest for pure modules. No new dependencies.

## Global Constraints

- Work tabs must never be registered with ElectronChromeExtensions (repo rule).
- No `session.webRequest`/`protocol.intercept*` handlers on extension-hosting sessions (repo rule).
- Pure logic in Electron-free modules with Vitest coverage; Electron-coupled code verified by manual smoke.
- `npm run typecheck` and `npm test` must pass before any "done" claim.
- Short conventional commits.

---

## Phase 1 — window-bundle foundation + Cmd+N (PR 1)

### Task 1: Global tab-id allocator

Tab ids (`tab-N`) are currently minted per-`TabManager` (`private counter`, `tab-manager.ts:53`), so two windows would both mint `tab-1`. Cross-window moves (phase 2) need process-unique ids.

**Files:**
- Create: `src/main/tab-ids.ts`
- Test: `tests/tab-ids.test.ts`
- Modify: `src/main/tab-manager.ts` (3 mint sites: `createTab` :73, `restorePins` :253, `syncBookmarks` :337; delete `counter` field :53)

**Interfaces:**
- Produces: `nextTabId(): string` — process-unique `tab-N` ids.

- [ ] **Step 1: Write the failing test** (`tests/tab-ids.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { nextTabId } from '../src/main/tab-ids'

describe('nextTabId', () => {
  it('mints unique ids across many calls (cross-manager contract)', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => nextTabId()))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(id).toMatch(/^tab-\d+$/)
  })
})
```

- [ ] **Step 2: Run `npx vitest run tests/tab-ids.test.ts`** — expect FAIL (module not found).
- [ ] **Step 3: Implement** `src/main/tab-ids.ts`:

```ts
// Process-wide tab id mint. Ids must be unique across ALL windows' TabManagers
// so a tab can move between windows (drag-out) without colliding.
let counter = 0
export function nextTabId(): string {
  return `tab-${++counter}`
}
```

- [ ] **Step 4: Replace the three `` `tab-${++this.counter}` `` sites in `tab-manager.ts`** with `nextTabId()` (import it), delete the `counter` field.
- [ ] **Step 5: `npx vitest run tests/tab-ids.test.ts` → PASS; `npm run typecheck` → clean. Commit** `feat: mint tab ids process-wide for multi-window`

### Task 2: `role` flag in snapshot + secondary chrome suppression

**Files:**
- Modify: `src/shared/ipc.ts` (TabsSnapshot :32), `src/main/tab-manager.ts` (opts + snapshot()), `src/renderer/main.ts` (render())

**Interfaces:**
- Produces: `TabsSnapshot.role: 'primary' | 'secondary'`; `TabManagerOptions.role?: 'primary' | 'secondary'` (default `'primary'`); exported type `WindowRole`.

- [ ] **Step 1:** `src/shared/ipc.ts`: add `export type WindowRole = 'primary' | 'secondary'` and `role: WindowRole` to `TabsSnapshot`.
- [ ] **Step 2:** `tab-manager.ts`: add `role?: WindowRole` to `TabManagerOptions`; `snapshot()` returns `role: this.opts.role ?? 'primary'`.
- [ ] **Step 3:** `src/renderer/main.ts`:
  - initial `snap` literal gets `role: 'primary'`.
  - in `render()`: `const secondary = snap.role === 'secondary'`; `document.body.classList.toggle('secondary', secondary)`; force-hide `pinGridEl`/`bookmarksEl` when secondary (`pinGridEl.hidden = secondary || …existing`), and hide the AI toggle: `aiToggleEl.hidden = secondary`.
- [ ] **Step 4: `npm run typecheck` + `npm test` → PASS. Commit** `feat: tabs snapshot carries window role; secondary chrome hides pins/bookmarks/AI`

### Task 3: `src/main/window.ts` — bundle factory + registry

Extract per-window wiring out of `index.ts:65-772` into a factory. This task creates the module; Task 4 rewires `index.ts` to use it.

**Files:**
- Create: `src/main/window.ts`

**Interfaces (produced — Tasks 4-9 depend on these exact names):**

```ts
export interface WindowBundle {
  win: BrowserWindow
  tabs: TabManager
  suggestions: SuggestionsOverlay
  sidebarResize: SidebarResizeController
  aiSidebarResize: SidebarResizeController
  role: WindowRole
  sidebarVisible: boolean          // per-window; initialized from uiStore
  aiVisible: boolean               // per-window; secondaries always false
  addDisposer(wc: WebContents, d: () => void): void   // phase 2: per-wc unwire hooks
  disposeFor(wc: WebContents): void
}
export interface WindowDeps {      // app-global services, built once in index.ts
  stores: { history; favicons; bookmarks; tabsStore; pinsStore; uiStore; settingsStore }
  extensions: ExtensionManager
  bookmarksChanged(): void         // primary-only re-sync + renderer notify
  onFirstSnapshotGate(): boolean   // returns sessionRestored flag (persistence gate)
}
export function createWindow(role: WindowRole, deps: WindowDeps,
  opts?: { position?: { x: number; y: number } }): WindowBundle
export function bundleFor(sender: WebContents): WindowBundle | null   // chrome/overlay wc → bundle
export function bundleOwningTab(wc: WebContents): WindowBundle | null // page wc → bundle (scan tabs.idFor)
export function focusedBundle(): WindowBundle | null                  // BrowserWindow.getFocusedWindow() → registry
export function primaryBundle(): WindowBundle | null                  // the primary if alive, else any bundle
export function allBundles(): WindowBundle[]
```

- [ ] **Step 1: Registry plumbing.** Module-level `const bundles = new Map<number /*win.id*/, WindowBundle>()` and `const byWc = new Map<number /*wc.id*/, WindowBundle>()`. `createWindow` registers `win.webContents` and `suggestions`' view webContents in `byWc`; `win.on('closed')` deletes both maps' entries and closes all the bundle's tab views (`tabs.webContentsFor` over a new `TabManager.allIds()` accessor — add it: returns `[...this.views.keys()]`, close each `view.webContents`).
- [ ] **Step 2: Move per-window construction** from `index.ts` into `createWindow`, parameterized by `role` (source line refs = current index.ts):
  - `BrowserWindow` creation (:124-131); apply `opts.position` via `win.setPosition` when given.
  - `attachCycleHooks` (:95-121) — per-window closure over this bundle's `tabs`; also attach to `win.webContents` (:238) and `win.on('blur', () => tabs.cycleCommit())` (:247). Register each attach with `bundle.addDisposer(wc, …)` so phase 2 can unwire a moving tab.
  - `TabManager` construction (:133-186) with `role`, and:
    - `onSnapshot`: always `win.webContents.send('tabs:updated', snap)`; the `tabsStore.save`/`pinsStore.save` block runs ONLY when `role === 'primary'` (and behind the existing `sessionRestored` gate via `deps.onFirstSnapshotGate()`).
    - `onTabCreated`: cycle hooks + `attachPageContextMenu(wc, win, …)` (openLinkInNewTab/bookmarkLink stay as today, using this bundle's `tabs`); `if (profile === 'default') deps.extensions.addTab(wc, win)` — note the new `win` argument (Task 5).
    - `onTabActivated`: `if (profile === 'default') deps.extensions.selectTab(wc)`.
    - secondary only: `onEmpty: () => win.close()` (see Step 3).
    - `getBookmark`/`onBookmarkFavicon`: primary as today; secondary: `getBookmark: () => undefined`, `onBookmarkFavicon` no-op (secondaries have no bookmark slots).
  - `SuggestionsOverlay` (:687), `SidebarResizeController` ×2 (:189-216) — per bundle; width init from `uiStore`, `onCommit` still persists to `uiStore` (shared preference).
  - `tabs.setSidebarVisible(uiStore.sidebarVisible())` for primary; secondary starts visible with `uiStore` width. `setAiSidebarVisible`: primary from uiStore, secondary always `false`.
  - `did-finish-load` push block (:733-741) per window (secondary sends `ui:ai-visible` false).
  - `win.loadURL/loadFile` (:743-747).
  - Primary-only startup restore (`restorePins`/`syncBookmarks`/`restoreTabs`, :754-759) stays in `index.ts` (Task 4); secondary `createWindow` ends with `tabs.createTab()` unless phase 2 passes an adopted tab.
- [ ] **Step 3: `TabManager.onEmpty`.** In `tab-manager.ts`, add `onEmpty?(): void` to `TabManagerOptions`; in `closeTab` (:136), `sleepSlot` (:194), the `destroyed` handler (:752) and `syncBookmarks` (:343), replace `this.createTab(); return` with:

```ts
if (this.opts.onEmpty) { this.opts.onEmpty(); return }
this.createTab()
return
```

- [ ] **Step 4: `npm run typecheck`** (index.ts not yet rewired — expect window.ts itself clean; unused-export warnings are fine). Commit `feat: window bundle factory + registry`

### Task 4: Rewire `index.ts` — sender-resolved IPC, app-global services

**Files:**
- Modify: `src/main/index.ts` (major), `src/main/media-permissions.ts`, `src/main/downloads.ts` (call-site only), `docs/superpowers/specs/2026-07-18-multi-window-design.md` (downloads wording)

**Interfaces:**
- Consumes: everything Task 3 produces.

- [ ] **Step 1: Sender resolution helper** at top of the whenReady closure:

```ts
const forSender = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): WindowBundle | null =>
  bundleFor(e.sender)
```

Every handler below resolves `const b = forSender(e); if (!b) return` and uses `b.tabs` / `b.win` instead of the captured `tabs` / `win`. Channel map (all currently at the cited lines):
  - `tabs:create/close/activate/navigate/back/forward/reload/nav-new-tab/stop/reorder/context-menu` (:261-316) → `b.tabs`; context-menu popup parents `b.win`.
  - `history:search` (:321) → profile from `b.tabs.activeId`.
  - `bookmarks:*` (:413-609) → replace `tabs` with `primaryBundle()!.tabs` is WRONG — use `b.tabs` (sender); dialogs and `.popup({ window: b.win })` parent the sender's window. (Only the primary renders bookmark UI, so behavior is unchanged; sender-resolution keeps it honest.)
  - `sugg:update` (:688) → `b.suggestions.update(p)`. `sugg:height`/`sugg:pick` (:692-702) → sender is the OVERLAY wc (registered in `byWc`): `b.suggestions.setHeight(...)`; pick sends `b.win.webContents.send('sugg:picked')` and navigates `b.tabs`.
  - `ui:set-overlay-height` (:685), `ui:sidebar-drag-start/end`, `ui:ai-drag-start/end` (:703-706) → `b.tabs` / `b.sidebarResize` / `b.aiSidebarResize`.
  - `ui:toggle-ai` (:708) / `ui:open-settings` (:711) → per-bundle (AI toggle no-ops for secondary bundles).
  - `find:start/step/stop` (:727-731) → `b.tabs`.
  - `shortcuts:recording` (:680) → `for (const w of allBundles()) w.win.webContents.setIgnoreMenuShortcuts(active === true)`.
  - Stay global (no bundle): `history:list`, `newtab:*`, `settings:*`, `shortcuts:list/set/reset/reset-all`, `downloads:reveal`, `ai:send/stop` (AI is primary-bound; controller unchanged, its `send` targets the primary bundle's webContents).
- [ ] **Step 2: Sidebar/AI toggles per window.** `toggleSidebar`/`toggleAiSidebar` (:225-236) become `(b: WindowBundle) => void`: flip `b.sidebarVisible`/`b.aiVisible`, call `b.tabs.setSidebarVisible(...)`, send to `b.win.webContents`, persist to `uiStore` (shared pref). AI toggle no-ops when `b.role === 'secondary'`.
- [ ] **Step 3: Bookmark commands per window.** `toggleBookmark` (:346-361) becomes `(b: WindowBundle) => void`; for `b.role === 'secondary'`: if the active tab's URL is http(s) and no existing bookmark has that URL+profile (`bookmarks.ordered().some(bm => bm.url === info.url && (bm.profile ?? 'default') === profile)`), `bookmarks.add(...)` + `bookmarksChanged()` — do NOT convert the tab to a slot. Primary path unchanged. `bookmarksChanged()` (:340) targets the primary bundle: `primaryBundle()?.tabs.syncBookmarks(...)` + send `ui:bookmarks-changed` to the primary's webContents.
- [ ] **Step 4: Launch-url routing** (:240-245): `openUrlInExistingWindow = (url) => { const b = focusedBundle() ?? primaryBundle(); if (!b) return; b.tabs.createTab(url); if (b.win.isMinimized()) b.win.restore(); b.win.focus() }`.
- [ ] **Step 5: Downloads broadcast.** `new DownloadManager((list) => { for (const b of allBundles()) b.win.webContents.send('downloads:updated', list) })`. Amend the spec's Section-2 downloads sentence to: "Downloads — session-level as today; the shelf list is global, so updates broadcast to every window's chrome." (routing a global list to one window would show a wrong subset).
- [ ] **Step 6: Permission prompts parent the requesting tab's window.** Change `attachPermissionPrompts(sess, win, store)` → `attachPermissionPrompts(sess, parentFor: (wc: WebContents) => BrowserWindow | null, store)`; the handler's first arg `_wc` becomes `wc` and `decide()` takes `parentFor(wc) ?? undefined` — when null, call `dialog.showMessageBox(opts)` without a parent. Call sites: `parentFor: (wc) => bundleOwningTab(wc)?.win ?? primaryBundle()?.win ?? null`.
- [ ] **Step 7: Primary window boot.** Replace :124-247 construction with `const primary = createWindow('primary', deps)`; keep the startup order — `await extensions.init()`, `primary.tabs.restorePins(...)`, `syncBookmarks`, `restoreTabs`, `sessionRestored = true`, `primary.tabs.refresh()`.
- [ ] **Step 8: `npm run typecheck` + `npm test` → PASS.** App still boots single-window (`npm run dev` smoke: tabs, suggestions, find, downloads shelf). Commit `refactor: sender-resolved IPC over window registry`

### Task 5: Multi-window ExtensionManager + focused-window menu + Cmd+N

**Files:**
- Modify: `src/main/extensions.ts`, `src/main/menu.ts`, `src/shared/shortcuts.ts`, `src/main/index.ts` (menu wiring)

**Interfaces:**
- Produces: `ExtensionManager` constructor `(resolve: { forTabWc(wc): TabManager | null; target(): { tabs: TabManager; win: BrowserWindow } | null })`; `addTab(wc: WebContents, win: BrowserWindow)`; `removeTab(wc: WebContents)` (pass-through, used by phase 2); `buildMenu(ctx)` with `ctx.bundle(): { … } | null` focused-or-primary resolver; new shortcut id `new-window` default `CmdOrCtrl+N`.

- [ ] **Step 1: `extensions.ts`.** Drop `private win`/`tabs` ctor args; take the resolver object above (index.ts supplies `forTabWc: (wc) => bundleOwningTab(wc)?.tabs ?? null`, `target: () => { const b = focusedBundle() ?? primaryBundle(); return b && { tabs: b.tabs, win: b.win } }`).
  - `createTab`: `const t = resolve.target(); if (!t) throw new Error('no window'); const id = t.tabs.createTab(details.url, details.active ?? true); return [t.tabs.webContentsFor(id)!, t.win]`.
  - `selectTab`/`removeTab` callbacks: `const tabs = resolve.forTabWc(wc)` then as today.
  - `addTab(wc, win)`: `this.extensions.addTab(wc, win)`. Add `removeTab(wc)`: `this.extensions.removeTab(wc)`.
  - Dialogs (`beforeInstall`, `remove`, `loadUnpacked`): parent `resolve.target()?.win`.
- [ ] **Step 2: `shared/shortcuts.ts`.** Insert `{ id: 'new-window', label: 'New Window', default: 'CmdOrCtrl+N' }` before `new-tab` in `SHORTCUT_COMMANDS`.
- [ ] **Step 3: `menu.ts`.** Replace `(win, tabs, …)` params with `ctx: { bundle(): WindowBundle | null; extensions; shortcuts; commands }`. Every click handler resolves `const b = ctx.bundle(); if (!b) return` at invocation time (`bundle()` = `focusedBundle() ?? primaryBundle()`), then uses `b.tabs` / `b.win.webContents`. `commands` methods now take the bundle: `toggleBookmark(b)`, `toggleSidebar(b)`, `toggleAiSidebar(b)`, `toggleSettings(b)`. Add to File submenu, above New Tab:

```ts
{ label: 'New Window', accelerator: shortcuts['new-window'],
  click: () => { createWindow('secondary', deps) } },
```

(index.ts passes a `newWindow()` command closure so menu.ts doesn't import the factory.)
- [ ] **Step 4: `npm run typecheck` + `npm test` → PASS. Commit** `feat: cmd+N secondary windows; menu and extensions act on the focused window`

### Task 6: Phase-1 verification

- [ ] `npm test` and `npm run typecheck` green.
- [ ] Runtime smoke (dev harness, per repo convention): boot; Cmd+N opens a secondary with a blank tab and minimal sidebar (no pins/bookmarks/AI toggle); tabs/urlbar/suggestions/find work in BOTH windows independently; Ctrl+Tab cycles per-window; menu commands hit the focused window; closing the secondary leaves the primary intact; quit+relaunch restores only the primary's tabs.
- [ ] Commit any fixes; then open **draft PR 1**.

---

## Phase 2 — drag a tab out into a new window (PR 2)

### Task 7: TabManager detach/adopt with listener disposal

Moving a live `WebContentsView` between windows must unwire every source-window-bound listener (tab events, cycle hooks, context menu, popup routing) and rewire on the destination — else Ctrl+Tab/context-menu on the moved tab drive the OLD window.

**Files:**
- Modify: `src/main/tab-manager.ts`, `src/main/page-context-menu-host.ts`

**Interfaces:**
- Produces: `TabManager.detachTab(id): DetachedTab | null` with `interface DetachedTab { id: string; view: WebContentsView; profile: ProfileId; favicon: string | null }`; `TabManager.adoptTab(t: DetachedTab): void`; `TabManagerOptions.onTabDetached?(wc: WebContents, profile: ProfileId): void`; `attachPageContextMenu(...)` now returns `() => void` (dispose).

- [ ] **Step 1: Tracked wiring.** Add `private wired = new Map<string, Array<() => void>>()` and

```ts
private track(id: string, wc: WebContents, event: string, fn: (...a: any[]) => void): void {
  wc.on(event as any, fn)
  const list = this.wired.get(id) ?? []
  list.push(() => { if (!wc.isDestroyed()) wc.removeListener(event as any, fn) })
  this.wired.set(id, list)
}
private unwire(id: string): void {
  for (const d of this.wired.get(id) ?? []) d()
  this.wired.delete(id)
}
```

Convert every `wc.on(...)` in `wireEvents` (:686-758) and the `did-create-window` listener in `wirePopupRouting` (:99) to `this.track(id, wc, …)`. Call `this.unwire(id)` in `destroyView` and `dropDeadView`.
- [ ] **Step 2: `attachPageContextMenu` returns a disposer** — hoist the handler to a named const, `wc.on('context-menu', handler)`, return `() => wc.removeListener('context-menu', handler)`.
- [ ] **Step 3: `detachTab`:**

```ts
detachTab(id: string): DetachedTab | null {
  const view = this.views.get(id)
  if (!view || this.model.isSlot(id) || isDeadView(view)) return null
  const wasAttached = this.attached === view
  if (wasAttached) {
    if (this.findText) { view.webContents.stopFindInPage('clearSelection'); this.findText = '' }
    this.win.contentView.removeChildView(view)
    this.attached = null
  }
  this.unwire(id)
  const profile = this.profileOf(id)
  this.opts.onTabDetached?.(view.webContents, profile)
  const favicon = this.favicons.get(id) ?? null
  this.model.close(id)
  this.views.delete(id)
  this.favicons.delete(id)
  this.profiles.delete(id)
  if (!this.model.activeId) {
    if (this.opts.onEmpty) this.opts.onEmpty()
    else this.createTab()
    return { id, view, profile, favicon }
  }
  this.syncViews()
  if (wasAttached) this.attached?.webContents.focus()
  return { id, view, profile, favicon }
}
```

- [ ] **Step 4: `adoptTab`:**

```ts
adoptTab(t: DetachedTab): void {
  this.profiles.set(t.id, t.profile)
  this.views.set(t.id, t.view)
  this.favicons.set(t.id, t.favicon)
  this.wireEvents(t.id, t.view.webContents)
  this.wirePopupRouting(t.view.webContents, t.id)   // replaces the source's setWindowOpenHandler
  this.opts.onTabCreated?.(t.view.webContents, t.profile) // dest window: cycle hooks, ctx menu, extensions
  this.model.add(t.id, true)
  this.syncViews()
  this.attached?.webContents.focus()
}
```

- [ ] **Step 5: `npm run typecheck` + `npm test` → PASS. Commit** `feat: TabManager can detach/adopt live tabs across windows`

### Task 8: Host-side unwire + `detachTabToNewWindow`

**Files:**
- Modify: `src/main/window.ts`

**Interfaces:**
- Consumes: Task 7's `detachTab`/`adoptTab`/`onTabDetached`; Task 5's `extensions.removeTab/addTab`.
- Produces: `detachTabToNewWindow(source: WindowBundle, tabId: string, screenX: number, screenY: number, deps: WindowDeps): void`; `createWindow` opts gain `adopt?: DetachedTab`.

- [ ] **Step 1:** In `createWindow`'s `onTabCreated` closure, register the cycle-hook and context-menu attachments through `bundle.addDisposer(wc, …)` (cycle hook: keep the handler reference and push `wc.removeListener('before-input-event', handler)`; context menu: push the disposer `attachPageContextMenu` now returns).
- [ ] **Step 2:** Wire `onTabDetached` in the TabManager options: `(wc, profile) => { bundle.disposeFor(wc); if (profile === 'default') deps.extensions.removeTab(wc) }`.
- [ ] **Step 3:**

```ts
export function detachTabToNewWindow(source: WindowBundle, tabId: string,
  screenX: number, screenY: number, deps: WindowDeps): void {
  const t = source.tabs.detachTab(tabId)
  if (!t) return
  const b = createWindow('secondary', deps, {
    position: { x: Math.max(0, Math.round(screenX) - 80), y: Math.max(0, Math.round(screenY) - 20) },
    adopt: t,
  })
  b.win.focus()
}
```

In `createWindow`, when `opts.adopt` is set, call `bundle.tabs.adoptTab(opts.adopt)` instead of the initial `tabs.createTab()`.
- [ ] **Step 4: `npm run typecheck` → PASS. Commit** `feat: detach a tab into a new secondary window`

### Task 9: Renderer drag-out detection + IPC

**Files:**
- Create: `src/shared/drag-out.ts`, `tests/drag-out.test.ts`
- Modify: `src/renderer/drag-list.ts`, `src/renderer/sidebar.ts` (:86 tab wireDragItem), `src/shared/ipc.ts` (SynapseApi.tabs), `src/preload/index.ts`, `src/main/index.ts`

**Interfaces:**
- Produces: `droppedOutsideViewport(pt: { clientX: number; clientY: number }, w: number, h: number): boolean`; `DragItemOpts.onDragOut?(e: DragEvent): void`; `SynapseApi.tabs.detach(id: string, screenX: number, screenY: number): void`; IPC `tabs:detach`.

- [ ] **Step 1: Failing test** (`tests/drag-out.test.ts`):

```ts
import { describe, expect, it } from 'vitest'
import { droppedOutsideViewport } from '../src/shared/drag-out'

describe('droppedOutsideViewport', () => {
  it('inside the viewport is not outside', () => {
    expect(droppedOutsideViewport({ clientX: 10, clientY: 10 }, 800, 600)).toBe(false)
    expect(droppedOutsideViewport({ clientX: 0, clientY: 0 }, 800, 600)).toBe(false)
    expect(droppedOutsideViewport({ clientX: 800, clientY: 600 }, 800, 600)).toBe(false)
  })
  it('any coordinate beyond an edge is outside', () => {
    expect(droppedOutsideViewport({ clientX: -1, clientY: 10 }, 800, 600)).toBe(true)
    expect(droppedOutsideViewport({ clientX: 10, clientY: -5 }, 800, 600)).toBe(true)
    expect(droppedOutsideViewport({ clientX: 801, clientY: 10 }, 800, 600)).toBe(true)
    expect(droppedOutsideViewport({ clientX: 10, clientY: 601 }, 800, 600)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it** — FAIL (module not found).
- [ ] **Step 3: Implement** `src/shared/drag-out.ts`:

```ts
// A dragend that lands outside the window's viewport means "tear this tab
// out". Inside the viewport (including over the page view, which draws over
// the chrome document) is never a tear-out.
export function droppedOutsideViewport(
  pt: { clientX: number; clientY: number }, w: number, h: number,
): boolean {
  return pt.clientX < 0 || pt.clientY < 0 || pt.clientX > w || pt.clientY > h
}
```

- [ ] **Step 4: `drag-list.ts`** — add `onDragOut?(e: DragEvent): void` to `DragItemOpts`; in the `dragend` listener (:39), before clearing:

```ts
el.addEventListener('dragend', (e) => {
  // an internal drop already nulled `drag`; a still-set drag that ended
  // outside the viewport is a tear-out
  if (drag && opts.onDragOut &&
      droppedOutsideViewport(e, window.innerWidth, window.innerHeight)) {
    opts.onDragOut(e)
  }
  drag = null
  clearIndicators()
})
```

- [ ] **Step 5: `sidebar.ts`** — in `renderTabList`'s `wireDragItem` (:86), add `onDragOut: (e) => window.synapse.tabs.detach(id, e.screenX, e.screenY)`. (Pins deliberately get none.)
- [ ] **Step 6: API + IPC.** `ipc.ts` SynapseApi.tabs: `detach(id: string, screenX: number, screenY: number): void`. Preload: `detach: (id, x, y) => ipcRenderer.send('tabs:detach', id, x, y)`. `index.ts`:

```ts
ipcMain.on('tabs:detach', (e, id: string, x: number, y: number) => {
  const b = forSender(e)
  if (!b || typeof id !== 'string' || !Number.isFinite(x) || !Number.isFinite(y)) return
  detachTabToNewWindow(b, id, x, y, deps)
})
```

- [ ] **Step 7: `npm run typecheck` + `npm test` → PASS. Commit** `feat: drag a tab out of the sidebar to tear it into a new window`

### Task 10: Phase-2 verification

- [ ] `npm test` + `npm run typecheck` green.
- [ ] Runtime smoke: drag a tab past the window edge → secondary spawns at the drop point with the SAME page (no reload — verify e.g. a playing YouTube video keeps playing); source window's list/active tab reconcile; reorder-inside-sidebar still works; drag-to-bookmark still works; Ctrl+Tab in the new window cycles ITS tabs; dragging the last tab out of a secondary closes the emptied window; dragging the only tab out of the primary leaves a fresh new-tab; Work-profile tab keeps its container after the move.
- [ ] Open **draft PR 2** (base: PR 1's branch).

## Self-review notes

- Spec coverage: Cmd+N (T5), ephemeral secondaries + minimal sidebar (T2-T4), sender-aware IPC + subsystem routing (T4-T5), drag-out with live view move (T7-T9), edge cases (T7 `onEmpty`, T9 pins excluded), testing strategy (T1/T9 pure tests + T6/T10 smoke).
- Deviation from spec, deliberate: downloads broadcast to all windows (global list); spec amended in T4.
- Type consistency: `WindowBundle`/`WindowDeps`/`DetachedTab`/`droppedOutsideViewport` names used identically across tasks.
