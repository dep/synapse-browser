# Pinned Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arc-style pinned tabs: persistent icon-grid slots at the top of the sidebar that lazy-load, share Cmd+1–9 addressing with regular tabs, and restore to their pinned URL via Ctrl+Cmd+H.

**Architecture:** A pin is a persistent slot `{url, title, favicon}` stored in `pins.json`, either **awake** (backed by a live `WebContentsView`) or **asleep** (slot only; wakes lazily on activation). The pure `TabModel` gains a `pinned: string[]` list; awake-ness is defined as membership in `mru`. `TabManager` maps pin ids to slots and routes close→sleep for pins. The renderer stays a pure function of `tabs:updated` snapshots, which grow `pinned`/`isPinned`/`isAsleep`/`pinnedUrl` fields. Context menus are native (`Menu.popup` in main), triggered from the renderer over one new IPC channel.

**Tech Stack:** Electron 43, electron-vite, TypeScript strict, Vitest. No runtime npm deps, no UI framework.

**Spec:** `docs/superpowers/specs/2026-07-04-pinned-tabs-design.md`

## Global Constraints

- TypeScript strict; no runtime npm dependencies; no UI framework in the renderer.
- Pure logic in Electron-free modules with Vitest coverage; Electron-coupled code verified by manual smoke.
- Short conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
- Run `npm run typecheck` before claiming any task done.
- Shortcuts (spec): Cmd+P = pin/unpin active tab; Ctrl+Cmd+H = restore active pin to pinned URL; Cmd+1–9 = combined sequence pins-then-tabs, Cmd+9 = last entry of the combined sequence.
- Pin grid: max 4 per row, wraps after 4; with n ≤ 4 pins each takes 1/n of the row width.
- **One deliberate deviation from the spec:** pin ids reuse the existing opaque `tab-<n>` counter instead of a `pin-<n>` prefix. Pinning morphs a live tab in place; renaming its id would have to touch `views`, `favicons`, and every model list for zero user-visible benefit. Ids are opaque — pin-ness is defined by membership in `model.pinned`/`snapshot.pinned`, never by id shape.

---

### Task 1: TabModel — pin/unpin, wake/sleep, combined addressing, cycling

**Files:**
- Modify: `src/main/tab-model.ts`
- Test: `tests/tab-model.test.ts`

**Interfaces:**
- Consumes: existing `TabModel` (`order`, `mru`, `activeId`, `add`, `activate`, `close`, `cycleStep`, `cycleCommit`, `isCycling`).
- Produces (used by Task 3):
  - `pinned: string[]` — pin ids in pin-row order (awake and asleep).
  - `pin(id: string): void` — move id from `order` to the tail of `pinned` (stays in `mru`).
  - `unpin(id: string): void` — move id from `pinned` to the **front** of `order`.
  - `addPin(id: string): void` — register a restored pin: in `pinned`, not in `mru` (asleep).
  - `wake(id: string, activate?: boolean): void` — asleep pin enters `mru` (default: front + active).
  - `sleep(id: string): void` — awake pin leaves `mru`; if it was active, hand off to `mru[0] ?? null`.
  - `isPinned(id: string): boolean`, `isAwake(id: string): boolean` (awake = in `mru`).
  - `at(index: number): string | null` — index into `[...pinned, ...order]`; negative counts from the end.
  - `activate(id)` now accepts awake pin ids; `close(id)` is a no-op on pinned ids; `cycleStep('order', …)` walks `[...awake pins, ...order]`.

- [ ] **Step 1: Write the failing tests**

Append this describe block to `tests/tab-model.test.ts`:

```ts
describe('TabModel pins', () => {
  let m: TabModel

  beforeEach(() => {
    m = new TabModel()
    m.add('a')
    m.add('b')
    m.add('c') // order [a, b, c], mru [c, b, a], active c
  })

  it('pin moves a tab from order to the pinned tail and keeps it awake', () => {
    m.pin('b')
    expect(m.order).toEqual(['a', 'c'])
    expect(m.pinned).toEqual(['b'])
    expect(m.mru).toEqual(['c', 'b', 'a'])
    expect(m.isPinned('b')).toBe(true)
    expect(m.isAwake('b')).toBe(true)
  })

  it('pin appends in pinning order', () => {
    m.pin('b')
    m.pin('a')
    expect(m.pinned).toEqual(['b', 'a'])
    expect(m.order).toEqual(['c'])
  })

  it('pin ignores unknown or already-pinned ids', () => {
    m.pin('b')
    m.pin('b')
    m.pin('nope')
    expect(m.pinned).toEqual(['b'])
    expect(m.order).toEqual(['a', 'c'])
  })

  it('unpin returns the pin to the top of the tab list', () => {
    m.pin('b')
    m.unpin('b')
    expect(m.pinned).toEqual([])
    expect(m.order).toEqual(['b', 'a', 'c'])
    expect(m.mru).toEqual(['c', 'b', 'a'])
  })

  it('restored pins start asleep: listed in pinned, absent from mru', () => {
    m.addPin('p1')
    expect(m.pinned).toEqual(['p1'])
    expect(m.mru).not.toContain('p1')
    expect(m.isAwake('p1')).toBe(false)
    expect(m.activeId).toBe('c')
  })

  it('wake activates and promotes to the MRU front', () => {
    m.addPin('p1')
    m.wake('p1')
    expect(m.activeId).toBe('p1')
    expect(m.mru).toEqual(['p1', 'c', 'b', 'a'])
    expect(m.isAwake('p1')).toBe(true)
  })

  it('wake without activation joins the MRU tail', () => {
    m.addPin('p1')
    m.wake('p1', false)
    expect(m.activeId).toBe('c')
    expect(m.mru).toEqual(['c', 'b', 'a', 'p1'])
  })

  it('wake is a no-op on already-awake or unpinned ids', () => {
    m.pin('b')
    m.wake('b')
    m.wake('a')
    expect(m.mru).toEqual(['c', 'b', 'a'])
    expect(m.activeId).toBe('c')
  })

  it('sleeping the active pin hands off to the MRU front, slot intact', () => {
    m.pin('c') // active pin
    m.sleep('c')
    expect(m.pinned).toEqual(['c'])
    expect(m.mru).toEqual(['b', 'a'])
    expect(m.activeId).toBe('b')
    expect(m.isAwake('c')).toBe(false)
  })

  it('sleeping a background pin keeps the active tab', () => {
    m.pin('a')
    m.sleep('a')
    expect(m.activeId).toBe('c')
    expect(m.mru).toEqual(['c', 'b'])
  })

  it('sleeping the only awake tab leaves no active id', () => {
    const solo = new TabModel()
    solo.add('x')
    solo.pin('x')
    solo.sleep('x')
    expect(solo.activeId).toBeNull()
    expect(solo.pinned).toEqual(['x'])
  })

  it('sleep is a no-op on regular tabs and asleep pins', () => {
    m.addPin('p1')
    m.sleep('p1')
    m.sleep('a')
    expect(m.mru).toEqual(['c', 'b', 'a'])
  })

  it('close is a no-op on pinned ids', () => {
    m.pin('b')
    m.close('b')
    expect(m.pinned).toEqual(['b'])
    expect(m.mru).toContain('b')
  })

  it('activate promotes an awake pin', () => {
    m.pin('a')
    m.activate('a')
    expect(m.activeId).toBe('a')
    expect(m.mru).toEqual(['a', 'c', 'b'])
  })

  it('unpinning a woken pin lands it awake at the top of the list', () => {
    m.addPin('p1')
    m.wake('p1')
    m.unpin('p1')
    expect(m.order).toEqual(['p1', 'a', 'b', 'c'])
    expect(m.activeId).toBe('p1')
  })

  it('at() addresses pins first, then tabs; negative from the end', () => {
    m.pin('b') // pinned [b], order [a, c]
    expect(m.at(0)).toBe('b')
    expect(m.at(1)).toBe('a')
    expect(m.at(2)).toBe('c')
    expect(m.at(-1)).toBe('c')
    expect(m.at(5)).toBeNull()
  })

  it('at(-1) falls back to the last pin when no regular tabs exist', () => {
    const solo = new TabModel()
    solo.add('x')
    solo.add('y')
    solo.pin('x')
    solo.pin('y')
    expect(solo.at(-1)).toBe('y')
  })

  it('order cycling walks awake pins then tabs, skipping asleep pins', () => {
    m.pin('a') // pinned [a] awake, order [b, c], active c
    m.addPin('p1') // asleep — must be skipped
    expect(m.cycleStep('order', 'forward')).toBe('a') // c wraps to the first awake entry
    expect(m.cycleStep('order', 'forward')).toBe('b')
    m.cycleCommit()
    expect(m.activeId).toBe('b')
  })

  it('MRU cycling includes awake pins and never asleep pins', () => {
    m.pin('b')
    m.addPin('p1')
    expect(m.cycleStep('mru', 'forward')).toBe('b')
    m.cycleCommit()
    expect(m.mru).toEqual(['b', 'c', 'a'])
  })

  it('wake and sleep commit an in-flight cycle first', () => {
    m.addPin('p1')
    m.cycleStep('mru', 'forward') // preview b
    m.wake('p1')
    expect(m.isCycling()).toBe(false)
    expect(m.mru).toEqual(['p1', 'b', 'c', 'a']) // preview b was committed as a visit
    m.cycleStep('mru', 'forward') // preview b
    m.sleep('p1')
    expect(m.isCycling()).toBe(false)
    expect(m.activeId).toBe('b')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/tab-model.test.ts`
Expected: the new `TabModel pins` block FAILS with errors like `m.pin is not a function`; every pre-existing test still PASSES.

- [ ] **Step 3: Implement pins in TabModel**

Replace the whole of `src/main/tab-model.ts` with:

```ts
export type CycleList = 'mru' | 'order'
export type Direction = 'forward' | 'back'

export class TabModel {
  order: string[] = []
  pinned: string[] = []
  mru: string[] = []
  activeId: string | null = null
  private cycling = false

  add(id: string, activate = true): void {
    this.order.push(id)
    if (activate) {
      if (this.cycling) this.cycleCommit()
      this.mru.unshift(id)
      this.activeId = id
    } else {
      this.mru.push(id)
    }
  }

  activate(id: string): void {
    if (!this.order.includes(id) && !this.pinned.includes(id)) return
    // an uncommitted cycle preview still counts as a visit
    if (this.cycling) this.cycleCommit()
    this.promote(id)
    this.activeId = id
  }

  close(id: string): void {
    if (!this.order.includes(id)) return // pins never close; they sleep
    if (this.cycling) this.cycleCommit()
    this.order = this.order.filter((t) => t !== id)
    this.mru = this.mru.filter((t) => t !== id)
    if (this.activeId === id) this.activeId = this.mru[0] ?? null
  }

  // a live tab becomes a pin in place: same id, same MRU standing
  pin(id: string): void {
    if (!this.order.includes(id)) return
    this.order = this.order.filter((t) => t !== id)
    this.pinned.push(id)
  }

  // the pin falls out of the row to the top of the tab list; the caller
  // must wake a sleeping pin first so it re-enters as a live tab
  unpin(id: string): void {
    if (!this.pinned.includes(id)) return
    this.pinned = this.pinned.filter((t) => t !== id)
    this.order.unshift(id)
    if (!this.mru.includes(id)) this.mru.push(id)
  }

  // a pin restored from disk: present in the row, asleep (no MRU standing)
  addPin(id: string): void {
    this.pinned.push(id)
  }

  wake(id: string, activate = true): void {
    if (!this.pinned.includes(id) || this.mru.includes(id)) return
    if (activate) {
      if (this.cycling) this.cycleCommit()
      this.mru.unshift(id)
      this.activeId = id
    } else {
      this.mru.push(id)
    }
  }

  sleep(id: string): void {
    if (!this.pinned.includes(id) || !this.mru.includes(id)) return
    if (this.cycling) this.cycleCommit()
    this.mru = this.mru.filter((t) => t !== id)
    if (this.activeId === id) this.activeId = this.mru[0] ?? null
  }

  isPinned(id: string): boolean {
    return this.pinned.includes(id)
  }

  isAwake(id: string): boolean {
    return this.mru.includes(id)
  }

  // index into pins-then-tabs; negative counts from the end (-1 = last)
  at(index: number): string | null {
    return [...this.pinned, ...this.order].at(index) ?? null
  }

  cycleStep(list: CycleList, dir: Direction): string | null {
    const ids =
      list === 'mru'
        ? this.mru
        : [...this.pinned.filter((t) => this.mru.includes(t)), ...this.order]
    if (ids.length < 2 || !this.activeId) return null
    const idx = ids.indexOf(this.activeId)
    const delta = dir === 'forward' ? 1 : -1
    const next = ids[(idx + delta + ids.length) % ids.length]
    this.activeId = next
    this.cycling = true
    return next
  }

  cycleCommit(): void {
    if (!this.cycling) return
    if (this.activeId) this.promote(this.activeId)
    this.cycling = false
  }

  isCycling(): boolean {
    return this.cycling
  }

  private promote(id: string): void {
    this.mru = this.mru.filter((t) => t !== id)
    this.mru.unshift(id)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/tab-model.test.ts`
Expected: ALL tests pass (old and new).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected: clean (nothing else references the new members yet).

```bash
git add src/main/tab-model.ts tests/tab-model.test.ts
git commit -m "feat: pin/unpin, wake/sleep, combined addressing in TabModel"
```

---

### Task 2: PinsStore — persistent pin slots

**Files:**
- Create: `src/main/pins-store.ts`
- Modify: `src/shared/ipc.ts` (add `PinSlot` only — the rest of the IPC changes land in Task 3)
- Test: `tests/pins-store.test.ts`

**Interfaces:**
- Consumes: `JsonStore` from `src/main/store.ts` (debounced JSON with `.bad` recovery).
- Produces (used by Tasks 3–4):
  - `PinSlot` in `src/shared/ipc.ts`: `{ url: string; title: string; favicon: string | null }`.
  - `class PinsStore { constructor(dir: string); save(pins: PinSlot[]): void; load(): PinSlot[]; flush(): void }` — persists to `<dir>/pins.json` as `{ v: 1, pins: PinSlot[] }`; only `http(s)` urls survive save/load.

- [ ] **Step 1: Add `PinSlot` to `src/shared/ipc.ts`**

Insert above `interface TabInfo`:

```ts
export interface PinSlot {
  url: string
  title: string
  favicon: string | null
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/pins-store.test.ts`:

```ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PinsStore } from '../src/main/pins-store'

describe('PinsStore', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinsstore-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('starts empty with no saved file', () => {
    expect(new PinsStore(dir).load()).toEqual([])
  })

  it('round-trips pin slots across instances', () => {
    const store = new PinsStore(dir)
    const pins = [
      { url: 'https://a.test/', title: 'A', favicon: 'https://a.test/icon.png' },
      { url: 'https://b.test/', title: 'B', favicon: null },
    ]
    store.save(pins)
    store.flush()
    expect(new PinsStore(dir).load()).toEqual(pins)
  })

  it('drops non-web urls on save', () => {
    const store = new PinsStore(dir)
    store.save([
      { url: 'about:blank', title: 'x', favicon: null },
      { url: 'https://ok.test/', title: 'ok', favicon: null },
      { url: 'data:text/html,hi', title: 'y', favicon: null },
    ])
    expect(store.load()).toEqual([{ url: 'https://ok.test/', title: 'ok', favicon: null }])
  })

  it('ignores malformed entries from a hand-edited file', () => {
    fs.writeFileSync(
      path.join(dir, 'pins.json'),
      JSON.stringify({
        v: 1,
        pins: [
          { url: 'https://ok.test/', title: 42, favicon: 7 },
          { title: 'no url' },
          'nonsense',
          null,
        ],
      }),
    )
    expect(new PinsStore(dir).load()).toEqual([
      { url: 'https://ok.test/', title: 'https://ok.test/', favicon: null },
    ])
  })

  it('recovers from a corrupt file', () => {
    fs.writeFileSync(path.join(dir, 'pins.json'), '{nope')
    expect(new PinsStore(dir).load()).toEqual([])
    expect(fs.existsSync(path.join(dir, 'pins.json.bad'))).toBe(true)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/pins-store.test.ts`
Expected: FAIL — cannot resolve `../src/main/pins-store`.

- [ ] **Step 4: Implement PinsStore**

Create `src/main/pins-store.ts`:

```ts
import * as path from 'node:path'
import type { PinSlot } from '../shared/ipc'
import { JsonStore } from './store'

interface PinsFile {
  v: 1
  pins: PinSlot[]
}

// pins are only ever real web pages; anything else has no url to restore to
const PERSISTABLE = /^https?:\/\//

export class PinsStore {
  private store: JsonStore<PinsFile>

  constructor(dir: string) {
    this.store = new JsonStore<PinsFile>(path.join(dir, 'pins.json'), { v: 1, pins: [] })
  }

  save(pins: PinSlot[]): void {
    this.store.set({ v: 1, pins: pins.filter((p) => PERSISTABLE.test(p.url)) })
  }

  load(): PinSlot[] {
    const { pins } = this.store.get()
    return (Array.isArray(pins) ? pins : [])
      .filter((p): p is PinSlot => !!p && typeof p === 'object' && typeof (p as PinSlot).url === 'string')
      .filter((p) => PERSISTABLE.test(p.url))
      .map((p) => ({
        url: p.url,
        title: typeof p.title === 'string' ? p.title : p.url,
        favicon: typeof p.favicon === 'string' ? p.favicon : null,
      }))
  }

  flush(): void {
    this.store.flush()
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/pins-store.test.ts`
Expected: ALL pass.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck` — expected: clean.

```bash
git add src/main/pins-store.ts src/shared/ipc.ts tests/pins-store.test.ts
git commit -m "feat: pins.json store for persistent pin slots"
```

---

### Task 3: Shared snapshot types + TabManager pin operations

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/tab-manager.ts`
- Modify: `src/preload/index.ts` (one-line API stub, Step 3)
- Modify: `src/renderer/main.ts` (snapshot literal, Step 3)

**Interfaces:**
- Consumes: Task 1's `TabModel` API (`pinned`, `pin`, `unpin`, `addPin`, `wake`, `sleep`, `isPinned`, `isAwake`, `at`), Task 2's `PinSlot`.
- Produces (used by Tasks 4–5):
  - `TabInfo` gains `isPinned: boolean; isAsleep: boolean; pinnedUrl: string | null`.
  - `TabsSnapshot` gains `pinned: string[]` (asleep pins appear in `tabs` keyed by id).
  - `SynapseApi.tabs` gains `showContextMenu(id: string): void`.
  - `TabManager` gains: `restorePins(slots: PinSlot[]): void`, `togglePin(id: string | null): void`, `restorePinnedUrl(id?: string | null): void`, `isPinned(id: string): boolean`, `isAwake(id: string): boolean`.
  - Changed behavior: `closeTab(pinnedId)` sleeps instead of closing; `activateTab(asleepPinId)` wakes it; `activateAt(i)` indexes `[...pinned, ...order]`.

- [ ] **Step 1: Extend the shared IPC types**

In `src/shared/ipc.ts`, add the three fields to `TabInfo`:

```ts
export interface TabInfo {
  id: string
  title: string
  url: string
  favicon: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isBookmarked: boolean
  isPinned: boolean
  isAsleep: boolean
  pinnedUrl: string | null
}
```

Add `pinned` to `TabsSnapshot`:

```ts
export interface TabsSnapshot {
  tabs: Record<string, TabInfo>
  order: string[]
  pinned: string[]
  activeId: string | null
}
```

Add to `SynapseApi.tabs` (after `reload`):

```ts
    showContextMenu(id: string): void
```

- [ ] **Step 2: Rework TabManager**

Apply these changes to `src/main/tab-manager.ts`.

Import `PinSlot`:

```ts
import type { PinSlot, TabInfo, TabsSnapshot } from '../shared/ipc'
```

Add the slot map field beside `favicons`:

```ts
  private pins = new Map<string, PinSlot>()
```

Extract view construction out of `createTab` so waking a pin can reuse it — replace the existing `createTab` with:

```ts
  createTab(url?: string, activate = true): string {
    const id = `tab-${++this.counter}`
    const view = this.createView(id)
    this.model.add(id, activate)
    if (url) view.webContents.loadURL(classifyInput(url))
    else if (activate) this.focusUrlBar()
    this.syncViews()
    return id
  }

  private createView(id: string): WebContentsView {
    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true },
    })
    this.views.set(id, view)
    this.favicons.set(id, null)
    this.wireEvents(id, view.webContents)
    this.opts.onTabCreated?.(view.webContents)
    view.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
      if (/^https?:\/\//.test(popupUrl)) this.createTab(popupUrl)
      return { action: 'deny' }
    })
    return view
  }
```

Replace `closeTab` (pins sleep instead of closing, and the empty check must consider awake pins, not just `order`):

```ts
  closeTab(id: string): void {
    if (this.model.isPinned(id)) {
      this.sleepPin(id)
      return
    }
    const view = this.views.get(id)
    if (!view) return
    const wasAttached = this.attached === view
    this.model.close(id)
    this.destroyView(id, view, wasAttached)
    if (!this.model.activeId) {
      this.createTab()
      return
    }
    this.syncViews()
    // destroying the focused view leaves no first responder, and Blink then
    // parks keyboard focus on the chrome toolbar's first enabled button
    if (wasAttached) this.attached?.webContents.focus()
  }

  private destroyView(id: string, view: WebContentsView, wasAttached: boolean): void {
    this.views.delete(id)
    this.favicons.delete(id)
    if (wasAttached) {
      this.win.contentView.removeChildView(view)
      this.attached = null
    }
    view.webContents.close()
  }

  private sleepPin(id: string): void {
    const view = this.views.get(id)
    if (!view) return // already asleep
    const slot = this.pins.get(id)
    if (slot) {
      // keep the freshest title/icon for the sleeping button
      slot.title = view.webContents.getTitle() || slot.title
      slot.favicon = this.favicons.get(id) ?? slot.favicon
    }
    const wasAttached = this.attached === view
    this.model.sleep(id)
    this.destroyView(id, view, wasAttached)
    if (!this.model.activeId) {
      this.createTab()
      return
    }
    this.syncViews()
    if (wasAttached) this.attached?.webContents.focus()
  }
```

Replace `activateTab` and add `wakePin`:

```ts
  activateTab(id: string): void {
    if (this.model.isPinned(id) && !this.views.has(id)) {
      this.wakePin(id)
      return
    }
    if (!this.views.has(id)) return
    this.model.activate(id)
    this.syncViews()
    this.attached?.webContents.focus()
  }

  private wakePin(id: string): void {
    const slot = this.pins.get(id)
    if (!slot) return
    const view = this.createView(id)
    this.model.wake(id)
    view.webContents.loadURL(slot.url)
    this.syncViews()
    this.attached?.webContents.focus()
  }
```

Add the pin API (below `restoreTabs`):

```ts
  // register saved pins as asleep slots; called once at startup before restoreTabs
  restorePins(slots: PinSlot[]): void {
    for (const slot of slots) {
      const id = `tab-${++this.counter}`
      this.pins.set(id, { ...slot })
      this.model.addPin(id)
    }
  }

  togglePin(id: string | null): void {
    if (!id) return
    if (this.model.isPinned(id)) {
      if (!this.views.has(id)) this.wakePin(id) // a sleeping pin re-enters as a live tab
      this.pins.delete(id)
      this.model.unpin(id)
    } else {
      const wc = this.views.get(id)?.webContents
      if (!wc) return
      const url = wc.getURL()
      if (!/^https?:\/\//.test(url)) return // blank/error tabs have no url to pin
      this.pins.set(id, { url, title: wc.getTitle() || url, favicon: this.favicons.get(id) ?? null })
      this.model.pin(id)
    }
    this.syncViews()
  }

  restorePinnedUrl(id: string | null = this.model.activeId): void {
    if (!id || !this.model.isPinned(id)) return
    const slot = this.pins.get(id)
    if (slot) this.views.get(id)?.webContents.loadURL(slot.url)
  }

  isPinned(id: string): boolean {
    return this.model.isPinned(id)
  }

  isAwake(id: string): boolean {
    return this.model.isAwake(id)
  }
```

Replace `activateAt` (combined addressing) — the existing comment changes too:

```ts
  // index into pins-then-tabs; negative counts from the end (-1 = last)
  activateAt(index: number): void {
    const id = this.model.at(index)
    if (id) this.activateTab(id)
  }
```

Replace `snapshot()` — pins (awake and asleep) come first, then regular tabs:

```ts
  private snapshot(): TabsSnapshot {
    const tabs: Record<string, TabInfo> = {}
    for (const id of [...this.model.pinned, ...this.model.order]) {
      const slot = this.pins.get(id)
      const wc = this.views.get(id)?.webContents
      if (wc) {
        const url = wc.getURL()
        tabs[id] = {
          id,
          title: wc.getTitle() || 'New Tab',
          url,
          favicon: this.favicons.get(id) ?? null,
          isLoading: wc.isLoading(),
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward(),
          isBookmarked: this.opts.isBookmarked(url),
          isPinned: !!slot,
          isAsleep: false,
          pinnedUrl: slot?.url ?? null,
        }
      } else if (slot) {
        tabs[id] = {
          id,
          title: slot.title,
          url: slot.url,
          favicon: slot.favicon,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          isBookmarked: this.opts.isBookmarked(slot.url),
          isPinned: true,
          isAsleep: true,
          pinnedUrl: slot.url,
        }
      }
    }
    return {
      tabs,
      order: [...this.model.order],
      pinned: [...this.model.pinned],
      activeId: this.model.activeId,
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: errors ONLY in `src/preload/index.ts` (missing `showContextMenu`) and `src/renderer/main.ts` (snapshot literal missing `pinned`). Fix the renderer literal now so Task 5 starts clean — in `src/renderer/main.ts`:

```ts
let snap: TabsSnapshot = { tabs: {}, order: [], pinned: [], activeId: null }
```

And add the preload stub — in `src/preload/index.ts`, after `reload`:

```ts
    showContextMenu: (id) => ipcRenderer.send('tabs:context-menu', id),
```

Re-run: `npm run typecheck` — expected: clean.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: ALL pass (model and store tests are unaffected by manager changes).

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/main/tab-manager.ts src/preload/index.ts src/renderer/main.ts
git commit -m "feat: pin slots, wake/sleep lifecycle, combined addressing in TabManager"
```

---

### Task 4: Main-process wiring — store, IPC, menu, context menu

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/menu.ts`

**Interfaces:**
- Consumes: `PinsStore` (Task 2), `TabManager.restorePins/togglePin/restorePinnedUrl/isPinned/isAwake/closeTab/activeId` (Task 3), IPC channel `'tabs:context-menu'` (preload sends it since Task 3).
- Produces: pins persist across restarts; Cmd+P / Ctrl+Cmd+H menu items; native right-click menu for tabs and pins.

- [ ] **Step 1: Wire PinsStore and the context menu in `src/main/index.ts`**

Add imports — extend the electron import and add `PinsStore`:

```ts
import { app, BrowserWindow, ipcMain, Menu, session } from 'electron'
```

```ts
import { PinsStore } from './pins-store'
```

After `const tabsStore = new TabsStore(userData)` add:

```ts
  const pinsStore = new PinsStore(userData)
```

In the `TabManager` options, replace the `onSnapshot` callback so pins persist alongside the session (title/favicon of an awake pin track the live page; `pinnedUrl` is always the saved url):

```ts
    onSnapshot: (snap) => {
      win.webContents.send('tabs:updated', snap)
      tabsStore.save(
        snap.order.map((id) => snap.tabs[id]!.url),
        snap.activeId ? snap.order.indexOf(snap.activeId) : -1,
      )
      pinsStore.save(
        snap.pinned.map((id) => ({
          url: snap.tabs[id]!.pinnedUrl ?? snap.tabs[id]!.url,
          title: snap.tabs[id]!.title,
          favicon: snap.tabs[id]!.favicon,
        })),
      )
    },
```

After the existing `ipcMain.on('tabs:reload', …)` line add the context-menu handler:

```ts
  ipcMain.on('tabs:context-menu', (_e, id: string) => {
    if (typeof id !== 'string') return
    const pinned = tabs.isPinned(id)
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: pinned ? 'Unpin Tab' : 'Pin Tab',
        click: () => tabs.togglePin(id),
      },
    ]
    if (pinned && tabs.isAwake(id)) {
      template.push({ label: 'Restore Pinned URL', click: () => tabs.restorePinnedUrl(id) })
    }
    template.push(
      { type: 'separator' },
      // closing a pin puts it to sleep; the slot stays in the row
      { label: pinned ? 'Close' : 'Close Tab', click: () => tabs.closeTab(id) },
    )
    Menu.buildFromTemplate(template).popup({ window: win })
  })
```

Before `const saved = tabsStore.load()` add (pins must exist before session tabs so they claim the first Cmd+1–9 slots):

```ts
  tabs.restorePins(pinsStore.load())
```

In the `before-quit` handler add:

```ts
    pinsStore.flush()
```

- [ ] **Step 2: Add the menu items in `src/main/menu.ts`**

Replace the `Tabs` menu entry with:

```ts
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
          label: 'Restore Pinned URL',
          accelerator: 'Control+CmdOrCtrl+H',
          click: () => tabs.restorePinnedUrl(),
        },
      ],
    },
```

- [ ] **Step 3: Typecheck and test**

Run: `npm run typecheck` — expected: clean.
Run: `npm test` — expected: ALL pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/main/menu.ts
git commit -m "feat: pin persistence, Cmd+P / Ctrl+Cmd+H, tab context menu"
```

---

### Task 5: Renderer — pin grid UI

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/sidebar.ts`
- Modify: `src/renderer/main.ts`
- Modify: `src/renderer/style.css`

**Interfaces:**
- Consumes: `TabsSnapshot.pinned`, `TabInfo.isAsleep`, `window.synapse.tabs.activate/showContextMenu` (Tasks 3–4).
- Produces: pin grid above the tab list — max 4 columns, pins flex to fill the row (n ≤ 4 pins → each 1/n wide), active highlight, dimmed asleep pins, right-click context menus on pins and tabs.

- [ ] **Step 1: Add the grid container to `src/renderer/index.html`**

Inside `<aside id="sidebar">`, directly above `<div id="tab-list"></div>`:

```html
        <div id="pin-grid" hidden></div>
```

- [ ] **Step 2: Render pins in `src/renderer/sidebar.ts`**

Add this export, and register the same `contextmenu` handler on regular tab items:

```ts
export function renderPins(el: HTMLElement, snap: TabsSnapshot): void {
  el.innerHTML = ''
  // n ≤ 4 pins each take 1/n of the row; past 4 it's a fixed 4-column grid
  el.style.gridTemplateColumns = `repeat(${Math.min(Math.max(snap.pinned.length, 1), 4)}, 1fr)`
  for (const id of snap.pinned) {
    const tab = snap.tabs[id]
    const btn = document.createElement('button')
    btn.className = 'pin' + (id === snap.activeId ? ' active' : '') + (tab.isAsleep ? ' asleep' : '')
    btn.title = tab.title

    const icon = document.createElement('img')
    icon.className = 'favicon'
    if (tab.favicon) icon.src = tab.favicon
    else icon.style.visibility = 'hidden'

    btn.append(icon)
    btn.addEventListener('click', () => window.synapse.tabs.activate(id))
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      window.synapse.tabs.showContextMenu(id)
    })
    el.append(btn)
  }
}
```

In `renderTabList`, after the existing `item.addEventListener('click', …)` line add:

```ts
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      window.synapse.tabs.showContextMenu(id)
    })
```

- [ ] **Step 3: Hook it up in `src/renderer/main.ts`**

Import `renderPins` alongside `renderTabList`:

```ts
import { renderPins, renderTabList } from './sidebar'
```

Add the element lookup next to `tabListEl`:

```ts
const pinGridEl = document.getElementById('pin-grid')!
```

Replace `render()`:

```ts
function render(): void {
  renderPins(pinGridEl, snap)
  renderTabList(tabListEl, snap)
  topbar.update(snap)
  pinGridEl.hidden = panelMode !== 'none' || snap.pinned.length === 0
  tabListEl.hidden = panelMode !== 'none'
  panelEl.hidden = panelMode === 'none'
}
```

- [ ] **Step 4: Style the grid in `src/renderer/style.css`**

Add after the `#sidebar-footer button:hover` rule:

```css
#pin-grid {
  display: grid;
  gap: 4px;
  margin-bottom: 8px;
  flex: none;
}
#pin-grid[hidden] {
  display: none;
}
.pin {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
}
.pin:hover {
  background: rgba(255, 255, 255, 0.1);
}
.pin.active {
  background: var(--bg-raised);
}
.pin.asleep .favicon {
  opacity: 0.45;
}
```

(`#pin-grid[hidden]` is required: the element's own `display: grid` would otherwise override the UA's `[hidden]` rule.)

- [ ] **Step 5: Typecheck, test, and manual smoke**

Run: `npm run typecheck` — expected: clean.
Run: `npm test` — expected: ALL pass.

Then `npm run dev` and walk this checklist (this is the feature's primary verification — Electron-coupled code has no unit tests by repo convention):

1. Open two sites; Cmd+P on one → it leaves the tab list and appears as a full-width icon button at the top. Pin the second → two 50% buttons. Open and pin three more → 4-column row plus a second row.
2. Cmd+1 activates the first pin; Cmd+5 (with 4 pins) activates the first regular tab; Cmd+9 activates the last regular tab.
3. Navigate a pinned tab away from its pinned URL, press Ctrl+Cmd+H → it returns. Ctrl+Cmd+H on a regular tab → nothing happens.
4. Cmd+W on the active pin → its button dims (asleep), an MRU tab activates, the pin stays. Click the dimmed pin → it reloads its pinned URL.
5. Right-click a pin → Unpin Tab / Restore Pinned URL (awake only) / Close. Right-click a regular tab → Pin Tab / Close Tab. Unpin → the tab reappears at the top of the tab list.
6. Quit and relaunch → pins come back dimmed (asleep) with their icons; session tabs restore as before; clicking a pin loads its pinned URL.
7. Ctrl+Tab cycling never lands on a dimmed pin; Option+Tab walks awake pins first, then tabs.
8. With a pin awake and one regular tab open, Cmd+W the regular tab → the awake pin activates (no phantom empty tab).
9. Open History (Cmd+Y) → the pin grid hides with the tab list; close it → both return.

Report any step that fails; do not proceed to commit until all pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/index.html src/renderer/sidebar.ts src/renderer/main.ts src/renderer/style.css
git commit -m "feat: pin grid in sidebar with context menus"
```

---

### Task 6: Docs

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: shipped behavior from Tasks 1–5.
- Produces: user-facing feature list and smoke notes that mention pins.

- [ ] **Step 1: Update the README feature list**

In `README.md`, add to the Features list after the "Vertical tabs" bullet:

```markdown
- Pinned tabs: icon grid atop the sidebar (Cmd+P to pin/unpin, right-click for menu);
  pins persist across restarts, wake lazily, share Cmd+1–9 with tabs (pins first), and
  Ctrl+Cmd+H returns the active pin to its pinned URL
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: pinned tabs in README"
```
