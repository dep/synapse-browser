# Bookmarks in the Sidebar (Arc-style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bookmarks become persistent tab slots rendered in the sidebar between the pin grid and the tab list; each bookmark can be assigned a profile (Default/Work) and opens in that profile's session partition. The bookmarks panel, ⌘B, and the ★ footer button are removed.

**Architecture:** Generalize the existing pin slot machinery: `TabModel` gains a second slot list (`bookmarks`) with the same sleep/wake semantics as pins; `TabManager` maps bookmark ids to tab ids and creates views in the bookmark's partition; `BookmarksStore` stays the source of truth for metadata (title, URL, folder, order, profile, favicon). The shared-anchored-tab machinery (`anchors` map, URL-based `openBookmark`, tabs-store `anchor` field) is deleted. Spec: `docs/superpowers/specs/2026-07-07-bookmarks-in-sidebar-design.md`.

**Tech Stack:** Electron + electron-vite + TypeScript (strict), Vitest, no UI framework, no new dependencies.

## Global Constraints

- TypeScript strict; `npm run typecheck` must pass at every commit.
- No runtime npm dependencies may be added.
- Pure logic stays in Electron-free modules (`src/shared/`, `tab-model.ts`, `bookmarks.ts`) with Vitest coverage; Electron-coupled code is verified by manual smoke.
- Work-profile views must NEVER be registered with ElectronChromeExtensions (existing `onTabCreated` gate handles this — do not bypass it).
- Never register `session.webRequest` or `protocol.intercept*` handlers (repo rule; not needed here).
- `bookmarks.json` stays `v: 2` — new `Bookmark` fields are optional, no migration.
- Profile UI labels are "Default" and "Work" (not "Personal").
- Short conventional commits (`feat:`, `fix:`, `chore:`); no backticks in commit messages.
- Run tests with `npm test`, typecheck with `npm run typecheck` (both from repo root).

---

### Task 1: TabModel bookmark slots

Bookmark slots mirror pin slots: they live outside `order`, sleep instead of closing, and wake via `wake()`. Their order is store-driven, so the model gets a `setBookmarkOrder` sync instead of participating in `reorder`.

**Files:**
- Modify: `src/main/tab-model.ts`
- Test: `tests/tab-model.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 3): on `TabModel` — `bookmarks: string[]` (public field), `bookmark(id: string): void`, `unbookmark(id: string): void`, `addBookmark(id: string): void`, `removeBookmark(id: string): void`, `setBookmarkOrder(ids: string[]): void`, `isBookmarkSlot(id: string): boolean`. Changed behavior: `activate`/`wake`/`sleep` accept bookmark slots; `at()` indexes `[...pinned, ...bookmarks, ...order]`; `'order'` cycling walks awake pins → awake bookmarks → tabs.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tab-model.test.ts`:

```ts
describe('TabModel bookmarks', () => {
  let m: TabModel

  beforeEach(() => {
    m = new TabModel()
    m.add('a')
    m.add('b')
    m.add('c') // order [a, b, c], mru [c, b, a], active c
  })

  it('bookmark moves a tab from order to bookmarks and keeps it awake', () => {
    m.bookmark('b')
    expect(m.order).toEqual(['a', 'c'])
    expect(m.bookmarks).toEqual(['b'])
    expect(m.isBookmarkSlot('b')).toBe(true)
    expect(m.isAwake('b')).toBe(true)
    expect(m.mru).toEqual(['c', 'b', 'a'])
  })

  it('bookmark ignores unknown or already-bookmarked ids', () => {
    m.bookmark('b')
    m.bookmark('b')
    m.bookmark('nope')
    expect(m.bookmarks).toEqual(['b'])
    expect(m.order).toEqual(['a', 'c'])
  })

  it('unbookmark returns the slot to the top of the tab list, awake', () => {
    m.bookmark('b')
    m.unbookmark('b')
    expect(m.bookmarks).toEqual([])
    expect(m.order).toEqual(['b', 'a', 'c'])
    expect(m.mru).toEqual(['c', 'b', 'a'])
  })

  it('restored bookmarks start asleep: listed, absent from mru', () => {
    m.addBookmark('bm1')
    expect(m.bookmarks).toEqual(['bm1'])
    expect(m.isAwake('bm1')).toBe(false)
    expect(m.activeId).toBe('c')
  })

  it('wake activates a bookmark slot and promotes it in MRU', () => {
    m.addBookmark('bm1')
    m.wake('bm1')
    expect(m.activeId).toBe('bm1')
    expect(m.mru).toEqual(['bm1', 'c', 'b', 'a'])
  })

  it('sleeping the active bookmark hands off to the MRU front, slot intact', () => {
    m.bookmark('c') // active bookmark
    m.sleep('c')
    expect(m.bookmarks).toEqual(['c'])
    expect(m.mru).toEqual(['b', 'a'])
    expect(m.activeId).toBe('b')
  })

  it('close is a no-op on bookmark slots', () => {
    m.bookmark('b')
    m.close('b')
    expect(m.bookmarks).toEqual(['b'])
    expect(m.mru).toContain('b')
  })

  it('activating an asleep bookmark is a no-op — asleep slots wake via wake()', () => {
    m.addBookmark('bm1')
    m.activate('bm1')
    expect(m.activeId).toBe('c')
    expect(m.isAwake('bm1')).toBe(false)
  })

  it('setBookmarkOrder reorders and drops unknown ids', () => {
    m.addBookmark('x')
    m.addBookmark('y')
    m.setBookmarkOrder(['y', 'x', 'ghost'])
    expect(m.bookmarks).toEqual(['y', 'x'])
  })

  it('removeBookmark drops the slot and hands off the active tab', () => {
    m.bookmark('c') // active bookmark
    m.removeBookmark('c')
    expect(m.bookmarks).toEqual([])
    expect(m.mru).toEqual(['b', 'a'])
    expect(m.activeId).toBe('b')
  })

  it('removeBookmark on an asleep slot just drops it', () => {
    m.addBookmark('bm1')
    m.removeBookmark('bm1')
    expect(m.bookmarks).toEqual([])
    expect(m.activeId).toBe('c')
  })

  it('at() addresses pins, then bookmarks, then tabs', () => {
    m.pin('a') // pinned [a], order [b, c]
    m.bookmark('b') // bookmarks [b], order [c]
    expect(m.at(0)).toBe('a')
    expect(m.at(1)).toBe('b')
    expect(m.at(2)).toBe('c')
    expect(m.at(-1)).toBe('c')
  })

  it('order cycling walks awake pins, awake bookmarks, then tabs', () => {
    m.pin('a') // awake pin
    m.bookmark('b') // awake bookmark
    m.addBookmark('bm1') // asleep — skipped
    // active c: forward wraps to first entry a, then b, then c
    expect(m.cycleStep('order', 'forward')).toBe('a')
    expect(m.cycleStep('order', 'forward')).toBe('b')
    expect(m.cycleStep('order', 'forward')).toBe('c')
  })

  it('MRU cycling includes awake bookmarks and never asleep ones', () => {
    m.bookmark('b')
    m.addBookmark('bm1')
    expect(m.cycleStep('mru', 'forward')).toBe('b')
    m.cycleCommit()
    expect(m.mru).toEqual(['b', 'c', 'a'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tab-model`
Expected: FAIL — `m.bookmark is not a function` (and related).

- [ ] **Step 3: Implement bookmark slots in TabModel**

In `src/main/tab-model.ts`:

Add field after `pinned`:

```ts
  bookmarks: string[] = []
```

Add a private helper after the fields:

```ts
  // pins and bookmarks are both "slots": they sleep instead of closing
  private isSlot(id: string): boolean {
    return this.pinned.includes(id) || this.bookmarks.includes(id)
  }
```

Replace the two `pinned.includes` guards in `activate` with `isSlot`:

```ts
  activate(id: string): void {
    if (!this.order.includes(id) && !this.isSlot(id)) return
    if (this.isSlot(id) && !this.mru.includes(id)) return // asleep slots wake via wake()
    // an uncommitted cycle preview still counts as a visit
    if (this.cycling) this.cycleCommit()
    this.promote(id)
    this.activeId = id
  }
```

Add after `addPin`:

```ts
  // a live tab becomes a bookmark slot in place: same id, same MRU standing
  bookmark(id: string): void {
    if (!this.order.includes(id)) return
    this.order = this.order.filter((t) => t !== id)
    this.bookmarks.push(id)
  }

  // the slot falls back to the top of the tab list; only awake slots are
  // unbookmarked (⌘D acts on the active tab) but mirror unpin defensively
  unbookmark(id: string): void {
    if (!this.bookmarks.includes(id)) return
    this.bookmarks = this.bookmarks.filter((t) => t !== id)
    this.order.unshift(id)
    if (!this.mru.includes(id)) this.mru.push(id)
  }

  // a bookmark restored from the store: present as a slot, asleep
  addBookmark(id: string): void {
    this.bookmarks.push(id)
  }

  // the bookmark was deleted outright: slot and MRU standing both go
  removeBookmark(id: string): void {
    if (!this.bookmarks.includes(id)) return
    if (this.cycling) this.cycleCommit()
    this.bookmarks = this.bookmarks.filter((t) => t !== id)
    this.mru = this.mru.filter((t) => t !== id)
    if (this.activeId === id) this.activeId = this.mru[0] ?? null
  }

  // bookmark order is store-driven (folders first, then top level); the
  // manager syncs it here so cycling and at() match the sidebar
  setBookmarkOrder(ids: string[]): void {
    const known = new Set(this.bookmarks)
    this.bookmarks = ids.filter((id) => known.has(id))
  }

  isBookmarkSlot(id: string): boolean {
    return this.bookmarks.includes(id)
  }
```

Generalize `wake` and `sleep` (replace `this.pinned.includes(id)` with `this.isSlot(id)`):

```ts
  wake(id: string, activate = true): void {
    if (!this.isSlot(id) || this.mru.includes(id)) return
    if (this.cycling) this.cycleCommit()
    if (activate) {
      this.mru.unshift(id)
      this.activeId = id
    } else {
      this.mru.push(id)
    }
  }

  sleep(id: string): void {
    if (!this.isSlot(id) || !this.mru.includes(id)) return
    if (this.cycling) this.cycleCommit()
    this.mru = this.mru.filter((t) => t !== id)
    if (this.activeId === id) this.activeId = this.mru[0] ?? null
  }
```

Update `at` and the `'order'` branch of `cycleStep`:

```ts
  // index into pins → bookmarks → tabs; negative counts from the end
  at(index: number): string | null {
    return [...this.pinned, ...this.bookmarks, ...this.order].at(index) ?? null
  }
```

```ts
    const ids =
      list === 'mru'
        ? this.mru
        : [
            ...this.pinned.filter((t) => this.mru.includes(t)),
            ...this.bookmarks.filter((t) => this.mru.includes(t)),
            ...this.order,
          ]
```

`close`, `pin`, `unpin`, `reorder`, MRU cycling, and `promote` are untouched (`close` already no-ops on slots because they are not in `order`; `reorder` deliberately excludes bookmarks — their order is store-driven).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tab-model`
Expected: PASS (all existing pin/cycle tests must still pass).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected: clean.

```bash
git add src/main/tab-model.ts tests/tab-model.test.ts
git commit -m "feat: bookmark slots in TabModel with pin-style sleep/wake"
```

---

### Task 2: BookmarksStore profile, favicon, add, ordered

**Files:**
- Modify: `src/shared/ipc.ts` (Bookmark interface only)
- Modify: `src/main/bookmarks.ts`
- Test: `tests/bookmarks.test.ts`

**Interfaces:**
- Consumes: `ProfileId` from `src/shared/ipc.ts`.
- Produces (used by Tasks 3–4): `Bookmark` gains `profile?: ProfileId` and `favicon?: string | null`. On `BookmarksStore`: `add(url: string, title: string, createdAt: number, profile?: ProfileId): Bookmark`, `get(id: string): Bookmark | undefined`, `setProfile(id: string, profile: ProfileId): void`, `setFavicon(id: string, favicon: string | null): void`, `ordered(): Bookmark[]`. (`toggle`/`isBookmarked` are deleted in Task 3, not here.)

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('BookmarksStore', ...)` block in `tests/bookmarks.test.ts`:

```ts
  it('add prepends at the top level and returns the bookmark', () => {
    const a = store.add('https://a.com', 'A', 1)
    const b = store.add('https://b.com', 'B', 2)
    expect(a.id).toBeTruthy()
    expect(a.profile).toBeUndefined()
    expect(store.list().bookmarks.map((x) => x.id)).toEqual([b.id, a.id])
    expect(store.get(a.id)).toEqual(a)
  })

  it('add with a work profile stores it; default stays absent', () => {
    const w = store.add('https://w.com', 'W', 1, 'work')
    const d = store.add('https://d.com', 'D', 2, 'default')
    expect(store.get(w.id)!.profile).toBe('work')
    expect(store.get(d.id)!.profile).toBeUndefined()
  })

  it('setProfile flips between work and default (default = field absent)', () => {
    const bm = store.add('https://a.com', 'A', 1)
    store.setProfile(bm.id, 'work')
    expect(store.get(bm.id)!.profile).toBe('work')
    store.setProfile(bm.id, 'default')
    expect(store.get(bm.id)!.profile).toBeUndefined()
  })

  it('setFavicon stores and clears', () => {
    const bm = store.add('https://a.com', 'A', 1)
    store.setFavicon(bm.id, 'https://a.com/i.png')
    expect(store.get(bm.id)!.favicon).toBe('https://a.com/i.png')
    store.setFavicon(bm.id, null)
    expect(store.get(bm.id)!.favicon).toBeUndefined()
  })

  it('setProfile and setFavicon on unknown ids are no-ops', () => {
    store.setProfile('nope', 'work')
    store.setFavicon('nope', 'x')
    expect(store.list().bookmarks).toEqual([])
  })

  it('ordered walks folder members in folder order, then top level', () => {
    const f1 = store.addFolder('One')
    const f2 = store.addFolder('Two')
    const a = store.add('https://a.com', 'a', 1)
    const b = store.add('https://b.com', 'b', 2)
    const c = store.add('https://c.com', 'c', 3) // top level: c, b, a
    store.moveToFolder(b.id, f2.id)
    store.moveToFolder(a.id, f1.id)
    expect(store.ordered().map((x) => x.title)).toEqual(['a', 'b', 'c'])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- bookmarks`
Expected: FAIL — `store.add is not a function` (and related).

- [ ] **Step 3: Implement**

In `src/shared/ipc.ts`, extend `Bookmark`:

```ts
export interface Bookmark {
  id: string
  url: string
  title: string
  createdAt: number
  folderId?: string // absent = top level
  profile?: ProfileId // absent = default
  favicon?: string | null // captured while the bookmark's tab is awake
}
```

Also import nothing new — `ProfileId` is already in the file.

In `src/main/bookmarks.ts`, import `ProfileId`:

```ts
import type { Bookmark, BookmarkFolder, BookmarksData, ProfileId } from '../shared/ipc'
```

Add after `isBookmarked`/`toggle` (leave those two in place for now — Task 3 deletes them):

```ts
  add(url: string, title: string, createdAt: number, profile: ProfileId = 'default'): Bookmark {
    const { folders, bookmarks } = this.data
    const bm: Bookmark = {
      id: randomUUID(),
      url,
      title,
      createdAt,
      ...(profile !== 'default' ? { profile } : {}),
    }
    this.store.set({ v: 2, folders, bookmarks: [bm, ...bookmarks] })
    return bm
  }

  get(id: string): Bookmark | undefined {
    return this.data.bookmarks.find((b) => b.id === id)
  }

  setProfile(id: string, profile: ProfileId): void {
    this.patch(id, (b) => {
      if (profile === 'default') delete b.profile
      else b.profile = profile
    })
  }

  setFavicon(id: string, favicon: string | null): void {
    this.patch(id, (b) => {
      if (favicon) b.favicon = favicon
      else delete b.favicon
    })
  }

  private patch(id: string, mutate: (b: Bookmark) => void): void {
    const { folders, bookmarks } = this.data
    this.store.set({
      v: 2,
      folders,
      bookmarks: bookmarks.map((b) => {
        if (b.id !== id) return b
        const next = { ...b }
        mutate(next)
        return next
      }),
    })
  }

  // sidebar visual order: each folder's members in folder order, then top level
  ordered(): Bookmark[] {
    const { folders, bookmarks } = this.data
    return [
      ...folders.flatMap((f) => bookmarks.filter((b) => b.folderId === f.id)),
      ...bookmarks.filter((b) => !b.folderId),
    ]
  }
```

DRY: rewrite `renameBookmark` to use `patch`:

```ts
  renameBookmark(id: string, title: string): void {
    this.patch(id, (b) => {
      b.title = title
    })
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- bookmarks`
Expected: PASS (all existing tests still pass).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected: clean.

```bash
git add src/shared/ipc.ts src/main/bookmarks.ts tests/bookmarks.test.ts
git commit -m "feat: bookmark profile, favicon, add and ordered in BookmarksStore"
```

---

### Task 3: Main-process integration — TabManager bookmark tabs, delete anchors, wire IPC and menus

After this task the app runs with the new engine under the old panel UI: panel clicks wake persistent bookmark tabs, ⌘D converts, the bookmark context menu has a Profile submenu, ⌘B is gone from the app menu. The renderer still compiles because all `SynapseApi` signatures are unchanged and `TabsSnapshot` only gains a field.

**Files:**
- Modify: `src/shared/ipc.ts` (TabsSnapshot)
- Modify: `src/main/tab-manager.ts`
- Modify: `src/main/tabs-store.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/menu.ts`
- Modify: `src/main/bookmarks.ts` (delete `toggle`, `isBookmarked`)
- Test: `tests/tabs-store.test.ts`, `tests/bookmarks.test.ts` (updates only)

**Interfaces:**
- Consumes: Task 1 TabModel API (`bookmark`, `unbookmark`, `addBookmark`, `removeBookmark`, `setBookmarkOrder`, `isBookmarkSlot`); Task 2 store API (`add`, `get`, `setProfile`, `setFavicon`, `ordered`).
- Produces (used by Task 4): `TabsSnapshot.bookmarkTabs: Record<string, string>` (bookmarkId → tabId, awake bookmark tabs only). `TabInfo.isBookmarked` now means "this tab IS a bookmark tab". On `TabManager`: `syncBookmarks(ordered: Bookmark[]): void`, `openBookmark(bookmarkId: string): void`, `bookmarkTab(tabId: string, bookmarkId: string): void`, `unbookmarkTab(bookmarkId: string): void`, `bookmarkIdOf(tabId: string): string | null`, `bookmarkTabIdOf(bookmarkId: string): string | null`. `TabManagerOptions` replaces `isBookmarked(url)` with `getBookmark(id): Bookmark | undefined` and adds `onBookmarkFavicon(id: string, favicon: string | null): void`. `restoreTabs` loses the `anchor` field.

- [ ] **Step 1: Update failing tests first (tabs-store and bookmarks)**

In `tests/tabs-store.test.ts`: delete the two tests `'round-trips a bookmark anchor'` and `'drops non-http anchors on save and load'` (lines 90–115).

In `tests/bookmarks.test.ts`:
- Delete the tests `'toggle adds a bookmark with an id and returns true'` and `'toggle removes an existing bookmark and returns false'`.
- Replace the `seed` helper body and every remaining `store.toggle(url, title, n)` call with `store.add(url, title, n)`:

```ts
  // add prepends, so adding A,B,C yields order [C,B,A]; helper for clarity
  function seed(urls: string[]): string[] {
    const ids = new Map(urls.map((url, i) => [url, store.add(url, url, i).id]))
    return urls.map((u) => ids.get(u)!)
  }
```

- In `'new bookmarks land at the top of the top level'`, `'remove deletes by id'`, `'renameBookmark ...'` (both), `'removeFolder removes an empty folder'`: replace `store.toggle(...)` with `store.add(...)` (same arguments).
- Replace `'persists via flush and reloads'` with:

```ts
  it('persists via flush and reloads', () => {
    const bm = store.add('https://a.com', 'A', 1)
    store.flush()
    const reloaded = new BookmarksStore(dir)
    expect(reloaded.list().bookmarks[0]!.id).toBe(bm.id)
  })
```

- [ ] **Step 2: Run tests to verify current state**

Run: `npm test`
Expected: bookmarks/tabs-store suites PASS already (only removals and equivalent replacements so far — `toggle` still exists). This confirms the test edits are sound before the code moves.

- [ ] **Step 3: Delete `toggle` and `isBookmarked` from BookmarksStore**

In `src/main/bookmarks.ts`, delete the `isBookmarked` and `toggle` methods entirely.

Run: `npm test -- bookmarks` — expected: PASS.
(`npm run typecheck` now fails in `index.ts` — fixed by Step 6.)

- [ ] **Step 4: Shared types and tabs-store**

In `src/shared/ipc.ts`, extend `TabsSnapshot`:

```ts
export interface TabsSnapshot {
  tabs: Record<string, TabInfo>
  order: string[]
  pinned: string[]
  bookmarkTabs: Record<string, string> // bookmarkId → tabId, awake only
  activeId: string | null
}
```

In `src/main/tabs-store.ts`:
- `TabEntry` drops `anchor` (delete the field and its comment).
- `save()` body becomes:

```ts
  save(tabs: TabEntry[], active: number): void {
    this.store.set({
      v: 2,
      tabs: tabs.map((t) => ({ url: PERSISTABLE.test(t.url) ? t.url : '', profile: t.profile })),
      active,
    })
  }
```

- In `load()`, drop `anchor` from the destructure and the returned entry:

```ts
      const { url, profile } = t as { url?: unknown; profile?: unknown }
      if (typeof url !== 'string') return []
      return [{ url, profile: profile === 'work' ? 'work' : 'default' }]
```

Run: `npm test -- tabs-store` — expected: PASS.

- [ ] **Step 5: TabManager — bookmark tabs, anchors deleted**

In `src/main/tab-manager.ts`:

Imports: add `Bookmark` to the type import from `../shared/ipc`.

`TabManagerOptions` — replace `isBookmarked` with the two bookmark callbacks:

```ts
export interface TabManagerOptions {
  getBookmark(id: string): Bookmark | undefined
  onBookmarkFavicon(id: string, favicon: string | null): void
  onNavigated(url: string, title: string): void
  onSnapshot(snap: TabsSnapshot): void
  onTabCreated?(wc: WebContents, profile: ProfileId): void
  onTabActivated?(wc: WebContents, profile: ProfileId): void
}
```

Fields: delete `private anchors = new Map<string, string>()`; add:

```ts
  private bmTabId = new Map<string, string>() // bookmarkId → tabId
```

Add lookup helpers near `profileOf`:

```ts
  bookmarkIdOf(tabId: string): string | null {
    for (const [bid, tid] of this.bmTabId) if (tid === tabId) return bid
    return null
  }

  bookmarkTabIdOf(bookmarkId: string): string | null {
    return this.bmTabId.get(bookmarkId) ?? null
  }
```

Add the slot registry sync (called at startup and on every store change):

```ts
  // reconcile bookmark slots with the store: new bookmarks get asleep slots,
  // deleted ones lose their slot (and live view), order mirrors the sidebar
  syncBookmarks(ordered: Bookmark[]): void {
    const live = new Set(ordered.map((b) => b.id))
    let destroyedAttached = false
    for (const [bid, tid] of [...this.bmTabId]) {
      if (live.has(bid)) continue
      const view = this.views.get(tid)
      if (view) {
        const wasAttached = this.attached === view
        destroyedAttached ||= wasAttached
        this.destroyView(tid, view, wasAttached)
      }
      this.model.removeBookmark(tid)
      this.profiles.delete(tid)
      this.bmTabId.delete(bid)
    }
    for (const b of ordered) {
      if (this.bmTabId.has(b.id)) continue
      const tid = `tab-${++this.counter}`
      this.bmTabId.set(b.id, tid)
      this.profiles.set(tid, b.profile ?? 'default')
      this.model.addBookmark(tid)
    }
    this.model.setBookmarkOrder(ordered.map((b) => this.bmTabId.get(b.id)!))
    if (destroyedAttached && !this.model.activeId) {
      this.createTab()
      return
    }
    this.syncViews()
    if (destroyedAttached) this.attached?.webContents.focus()
  }
```

Replace the URL-based `openBookmark` with id-based open + wake (delete the old method and its comment entirely):

```ts
  openBookmark(bookmarkId: string): void {
    const tid = this.bmTabId.get(bookmarkId)
    if (tid) this.activateTab(tid)
  }

  private wakeBookmark(tabId: string): void {
    const bid = this.bookmarkIdOf(tabId)
    const bm = bid ? this.opts.getBookmark(bid) : undefined
    if (!bm) return
    // profile can have changed while asleep; the store is authoritative
    this.profiles.set(tabId, bm.profile ?? 'default')
    const view = this.createView(tabId)
    this.model.wake(tabId)
    view.webContents.loadURL(bm.url)
    this.syncViews()
    this.attached?.webContents.focus()
  }
```

Generalize `activateTab` to wake either slot kind:

```ts
  activateTab(id: string): void {
    if (!this.views.has(id)) {
      if (this.model.isPinned(id)) this.wakePin(id)
      else if (this.model.isBookmarkSlot(id)) this.wakeBookmark(id)
      return
    }
    this.model.activate(id)
    this.syncViews()
    this.attached?.webContents.focus()
  }
```

(Delete the old `if (this.model.isPinned(id) && !this.views.has(id))` block it replaces. `wakePin` keeps its own guard clause.)

Generalize sleeping: rename `sleepPin` to `sleepSlot` (the pin-slot freshness lines are conditional on `pins.get`, so bookmarks pass through them harmlessly), and route both slot kinds in `closeTab`:

```ts
  closeTab(id: string): void {
    if (this.model.isPinned(id) || this.model.isBookmarkSlot(id)) {
      this.sleepSlot(id)
      return
    }
    const view = this.views.get(id)
    if (!view) return
    const wasAttached = this.attached === view
    this.model.close(id)
    this.destroyView(id, view, wasAttached)
    this.profiles.delete(id)
    if (!this.model.activeId) {
      this.createTab()
      return
    }
    this.syncViews()
    // destroying the focused view leaves no first responder, and Blink then
    // parks keyboard focus on the chrome toolbar's first enabled button
    if (wasAttached) this.attached?.webContents.focus()
  }

  private sleepSlot(id: string): void {
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

Add conversion methods (⌘D wiring lands in `index.ts`):

```ts
  // ⌘D: a live tab becomes the bookmark's tab in place
  bookmarkTab(tabId: string, bookmarkId: string): void {
    this.bmTabId.set(bookmarkId, tabId)
    this.model.bookmark(tabId)
  }

  // ⌘D again: the page survives as a normal tab; an asleep slot just vanishes
  unbookmarkTab(bookmarkId: string): void {
    const tid = this.bmTabId.get(bookmarkId)
    if (!tid) return
    this.bmTabId.delete(bookmarkId)
    if (this.views.has(tid)) this.model.unbookmark(tid)
    else {
      this.model.removeBookmark(tid)
      this.profiles.delete(tid)
    }
  }
```

`restoreAnchor` — bookmark URL comes from the store now:

```ts
  restoreAnchor(id: string | null = this.model.activeId): void {
    if (!id) return
    const bid = this.bookmarkIdOf(id)
    const url = this.pins.get(id)?.url ?? (bid ? this.opts.getBookmark(bid)?.url : undefined)
    if (url) this.views.get(id)?.webContents.loadURL(url)
  }
```

Delete `isAnchored` entirely. In `closeTab`, delete the `this.anchors.delete(id)` line. In `restoreTabs`, drop the anchor parameter and handling:

```ts
  restoreTabs(tabs: { url: string; profile: ProfileId }[], active: number): void {
    if (tabs.length === 0) {
      this.createTab()
      return
    }
    const ids = tabs.map((t) => this.createTab(t.url || undefined, false, t.profile))
    this.activateTab(ids[Math.min(Math.max(active, 0), ids.length - 1)]!)
  }
```

In `wireEvents`, persist live favicons for bookmark tabs:

```ts
    wc.on('page-favicon-updated', (_e, favicons) => {
      this.favicons.set(id, favicons[0] ?? null)
      const bid = this.bookmarkIdOf(id)
      if (bid) this.opts.onBookmarkFavicon(bid, favicons[0] ?? null)
      this.refresh()
    })
```

`snapshot()` — iterate all three groups, expose awake bookmark tabs, and switch `isBookmarked`/`anchorUrl` to identity semantics:

```ts
  private snapshot(): TabsSnapshot {
    const tabs: Record<string, TabInfo> = {}
    for (const id of [...this.model.pinned, ...this.model.bookmarks, ...this.model.order]) {
      const slot = this.pins.get(id)
      const bid = this.bookmarkIdOf(id)
      const wc = this.views.get(id)?.webContents
      if (wc) {
        const url = wc.getURL()
        tabs[id] = {
          id,
          title: wc.getTitle() || slot?.title || 'New Tab',
          url,
          favicon: this.favicons.get(id) ?? slot?.favicon ?? null,
          isLoading: wc.isLoading(),
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward(),
          isBookmarked: bid !== null,
          isPinned: !!slot,
          isAsleep: false,
          anchorUrl: slot?.url ?? (bid ? (this.opts.getBookmark(bid)?.url ?? null) : null),
          profile: this.profileOf(id),
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
          isBookmarked: false,
          isPinned: true,
          isAsleep: true,
          anchorUrl: slot.url,
          profile: this.profileOf(id),
        }
      }
    }
    const bookmarkTabs: Record<string, string> = {}
    for (const [bid, tid] of this.bmTabId) if (this.views.has(tid)) bookmarkTabs[bid] = tid
    return {
      tabs,
      order: [...this.model.order],
      pinned: [...this.model.pinned],
      bookmarkTabs,
      activeId: this.model.activeId,
    }
  }
```

(Asleep bookmark slots produce no `tabs` entry — the renderer draws those rows from store data.)

- [ ] **Step 6: index.ts and menu.ts wiring**

In `src/main/index.ts`:

TabManager construction — replace `isBookmarked` and drop the anchor from the tabs-store save:

```ts
  const tabs = new TabManager(win, {
    getBookmark: (id) => bookmarks.get(id),
    onBookmarkFavicon: (id, favicon) => {
      bookmarks.setFavicon(id, favicon)
      win.webContents.send('ui:bookmarks-changed')
    },
    onNavigated: (url, title) => history.add(url, title, Date.now()),
    onSnapshot: (snap) => {
      win.webContents.send('tabs:updated', snap)
      tabsStore.save(
        snap.order.map((id) => {
          const t = snap.tabs[id]!
          return { url: t.url, profile: t.profile }
        }),
        snap.activeId ? snap.order.indexOf(snap.activeId) : -1,
      )
      pinsStore.save(
        snap.pinned.map((id) => ({
          url: snap.tabs[id]!.anchorUrl ?? snap.tabs[id]!.url,
          title: snap.tabs[id]!.title,
          favicon: snap.tabs[id]!.favicon,
          profile: snap.tabs[id]!.profile,
        })),
      )
    },
    // `extensions` is declared below; safe because tabs are only created
    // after it exists (restoreTabs runs at the end of startup)
    // Work tabs are deliberately invisible to ElectronChromeExtensions —
    // registering them would expose Work-container URLs to default-session
    // extensions through chrome.tabs
    onTabCreated: (wc, profile) => {
      attachCycleHooks(wc)
      if (profile === 'default') extensions.addTab(wc)
    },
    onTabActivated: (wc, profile) => {
      if (profile === 'default') extensions.selectTab(wc)
    },
  })
```

`bookmarksChanged` — sync slots then notify (replace the existing function; `syncBookmarks` ends in a refresh, so the explicit `tabs.refresh()` goes away):

```ts
  const bookmarksChanged = (): void => {
    tabs.syncBookmarks(bookmarks.ordered())
    win.webContents.send('ui:bookmarks-changed')
  }
```

`toggleBookmark` — conversion toggle:

```ts
  // ⌘D / ☆: convert the active tab into a bookmark, or a bookmark tab back
  const toggleBookmark = (): void => {
    const tid = tabs.activeId
    if (!tid) return
    const bid = tabs.bookmarkIdOf(tid)
    if (bid) {
      bookmarks.remove(bid)
      tabs.unbookmarkTab(bid)
    } else {
      const info = tabs.activeInfo()
      if (!info || !/^https?:\/\//.test(info.url)) return
      const bm = bookmarks.add(info.url, info.title, Date.now(), tabs.profileOf(tid))
      tabs.bookmarkTab(tid, bm.id)
    }
    bookmarksChanged()
  }
```

`bookmarks:open` handler:

```ts
  ipcMain.on('bookmarks:open', (_e, id: string) => {
    if (typeof id === 'string') tabs.openBookmark(id)
  })
```

`tabs:context-menu` — delete the anchored branch; the block becomes:

```ts
    if (pinned && tabs.isAwake(id)) {
      template.push({ label: 'Restore Pinned URL', click: () => tabs.restoreAnchor(id) })
    }
```

`bookmarks:context-menu` — the `kind === 'bookmark'` branch gains Profile / Restore / Sleep items:

```ts
    } else if (kind === 'bookmark') {
      const { folders, bookmarks: all } = bookmarks.list()
      const bm = all.find((b) => b.id === id)
      if (!bm) return
      const tid = tabs.bookmarkTabIdOf(id)
      const awake = tid !== null && tabs.isAwake(tid)
      const currentUrl = awake ? tabs.webContentsFor(tid!)?.getURL() : undefined
      const moveTo = (folderId: string | null) => () => {
        bookmarks.moveToFolder(id, folderId)
        bookmarksChanged()
      }
      const setProfile = (profile: ProfileId) => () => {
        bookmarks.setProfile(id, profile)
        // an awake tab must move partitions now; asleep slots pick the
        // profile up from the store on wake
        if (awake) tabs.setProfile(tid!, profile)
        bookmarksChanged()
      }
      const template: Electron.MenuItemConstructorOptions[] = [
        { label: 'Rename', click: () => win.webContents.send('ui:edit-bookmark', id) },
        {
          label: 'Move to',
          submenu: [
            { label: 'Top Level', type: 'radio', checked: !bm.folderId, click: moveTo(null) },
            ...folders.map(
              (f): Electron.MenuItemConstructorOptions => ({
                label: f.name,
                type: 'radio',
                checked: bm.folderId === f.id,
                click: moveTo(f.id),
              }),
            ),
          ],
        },
        { type: 'separator' },
        {
          label: 'Profile',
          submenu: [
            {
              label: 'Default',
              type: 'radio',
              checked: (bm.profile ?? 'default') === 'default',
              click: setProfile('default'),
            },
            {
              label: 'Work',
              type: 'radio',
              checked: bm.profile === 'work',
              click: setProfile('work'),
            },
          ],
        },
      ]
      if (awake && currentUrl !== bm.url) {
        template.push({ label: 'Restore Bookmarked URL', click: () => tabs.restoreAnchor(tid) })
      }
      if (awake) {
        template.push({ label: 'Put to Sleep', click: () => tabs.closeTab(tid!) })
      }
      template.push(
        { type: 'separator' },
        {
          label: 'Delete Bookmark',
          click: () => {
            bookmarks.remove(id)
            bookmarksChanged()
          },
        },
      )
      Menu.buildFromTemplate(template).popup({ window: win })
    }
```

Add the `ProfileId` type import in `index.ts`:

```ts
import type { ProfileId } from '../shared/ipc'
```

Startup — register bookmark slots before restoring tabs (after `tabs.restorePins(pinsStore.load())`):

```ts
  tabs.restorePins(pinsStore.load())
  tabs.syncBookmarks(bookmarks.ordered())
  const saved = tabsStore.load()
  tabs.restoreTabs(saved.tabs, saved.active)
```

In `src/main/menu.ts`: delete the `Bookmarks` / `CmdOrCtrl+B` menu item (the `ui:toggle-bookmarks` send). Keep `Bookmark This Page` (⌘D) and `History` (⌘Y).

- [ ] **Step 7: Typecheck, run all tests**

Run: `npm run typecheck` — expected: clean (renderer untouched: `SynapseApi` unchanged, `TabsSnapshot` gained a field, `TabInfo` shape unchanged).
Run: `npm test` — expected: PASS.

- [ ] **Step 8: Manual smoke (old UI, new engine)**

Run: `npm run dev`. Verify:
1. ⌘D on a page: star fills; ⌘B panel… is gone from the menu, so open the panel via the ★ footer button — the bookmark is listed.
2. Clicking a bookmark in the panel opens it; clicking it again reuses the same tab (no pile-up).
3. Right-click bookmark in panel → Profile → Work: reopening it loads in the Work partition (check a cookie-bearing site shows logged-out state).
4. ⌘D on the bookmark's tab removes the bookmark and the page stays open as a normal tab.
5. Restart: bookmarks persist; no anchored tabs are restored.

- [ ] **Step 9: Commit**

```bash
git add src/shared/ipc.ts src/main src/preload tests
git commit -m "feat: bookmark tabs with per-bookmark profiles in main process"
```

---

### Task 4: Renderer — bookmark section in the sidebar, remove panel mode and ⌘B plumbing

**Files:**
- Create: `src/renderer/bookmarks-section.ts`
- Modify: `src/renderer/main.ts`, `src/renderer/panel.ts`, `src/renderer/index.html`, `src/renderer/style.css`, `src/renderer/topbar.ts`
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts` (remove `onToggleBookmarks`)
- Modify: `README.md`

**Interfaces:**
- Consumes: `TabsSnapshot.bookmarkTabs` (Task 3), `Bookmark.profile`/`favicon` (Task 2), unchanged `window.synapse.bookmarks.*` IPC.
- Produces: `renderBookmarks(el: HTMLElement, data: BookmarksData, snap: TabsSnapshot, onRerender: () => void): void` and `startItemEdit(id: string): void` exported from `bookmarks-section.ts`. `PanelMode` narrows to `'none' | 'history'`.

- [ ] **Step 1: Create `src/renderer/bookmarks-section.ts`**

Complete file (folder rows, editors, and drag logic are carried over from `panel.ts`; bookmark rows are restyled as tab rows driven by the snapshot):

```ts
import type { Bookmark, BookmarkFolder, BookmarksData, TabsSnapshot } from '../shared/ipc'
import { wireDragItem, wireDropZone } from './drag-list'

const collapsed = new Set<string>()
// id of the folder or bookmark being renamed, 'new' while naming a new
// folder, null when idle — one inline editor at a time
let editing: string | null = null
let rerender: (() => void) | null = null

export function startItemEdit(id: string): void {
  editing = id
  rerender?.()
}

export function renderBookmarks(
  el: HTMLElement,
  data: BookmarksData,
  snap: TabsSnapshot,
  onRerender: () => void,
): void {
  rerender = onRerender
  const { folders, bookmarks } = data
  el.innerHTML = ''

  const heading = document.createElement('div')
  heading.className = 'panel-heading'
  const label = document.createElement('span')
  label.textContent = 'Bookmarks'
  const newFolder = document.createElement('button')
  newFolder.className = 'panel-action'
  newFolder.textContent = '＋ Folder'
  newFolder.title = 'New Folder'
  newFolder.addEventListener('click', () => startItemEdit('new'))
  heading.append(label, newFolder)
  el.append(heading)

  if (editing === 'new') el.append(folderEditor(null))

  folders.forEach((folder, i) => {
    if (editing === folder.id) {
      el.append(folderEditor(folder))
      return
    }
    const members = bookmarks.filter((b) => b.folderId === folder.id)
    el.append(folderRow(folder, i, folders, members.length))
    if (!collapsed.has(folder.id)) {
      members.forEach((bm, j) =>
        el.append(
          editing === bm.id ? bookmarkEditor(bm, true) : bookmarkRow(bm, j, members, true, snap),
        ),
      )
    }
  })

  // loose bookmarks get their own container so its empty space below the
  // rows is a "move to top level" drop target
  const topLevel = bookmarks.filter((b) => !b.folderId)
  const loose = document.createElement('div')
  loose.className = 'bookmarks-loose'
  topLevel.forEach((bm, j) =>
    loose.append(
      editing === bm.id ? bookmarkEditor(bm, false) : bookmarkRow(bm, j, topLevel, false, snap),
    ),
  )
  wireDropZone(loose, {
    accepts: (d) => d.kind === 'bookmark',
    onDrop: (d) => window.synapse.bookmarks.moveToFolder(d.id, null),
  })
  el.append(loose)
}

function bookmarkRow(
  bm: Bookmark,
  index: number,
  siblings: Bookmark[],
  indented: boolean,
  snap: TabsSnapshot,
): HTMLDivElement {
  const tabId = snap.bookmarkTabs[bm.id]
  const tab = tabId ? snap.tabs[tabId] : undefined
  const row = document.createElement('div')
  row.className =
    'tab bookmark' +
    (tabId && tabId === snap.activeId ? ' active' : '') +
    (tab ? '' : ' asleep') +
    (indented ? ' indent' : '')

  const icon = document.createElement('img')
  icon.className = 'favicon'
  icon.onerror = () => (icon.style.visibility = 'hidden')
  const src = tab?.favicon ?? bm.favicon
  if (src) icon.src = src
  else icon.style.visibility = 'hidden'

  const title = document.createElement('span')
  title.className = 'tab-title'
  title.textContent = tab?.isLoading ? `… ${bm.title}` : bm.title
  row.append(icon, title)

  if ((bm.profile ?? 'default') === 'work') {
    const dot = document.createElement('span')
    dot.className = 'profile-dot'
    dot.title = 'Work profile'
    row.append(dot)
  }

  if (tab) {
    const close = document.createElement('button')
    close.className = 'tab-close'
    close.textContent = '×'
    close.title = 'Put to sleep'
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      window.synapse.tabs.close(tabId!)
    })
    row.append(close)
  }

  // single click opens after a beat; a double-click cancels it and renames
  // instead, so renaming never navigates
  let clickTimer: ReturnType<typeof setTimeout> | null = null
  row.addEventListener('click', () => {
    if (clickTimer) clearTimeout(clickTimer)
    clickTimer = setTimeout(() => window.synapse.bookmarks.open(bm.id), 250)
  })
  row.addEventListener('dblclick', () => {
    if (clickTimer) clearTimeout(clickTimer)
    clickTimer = null
    startItemEdit(bm.id)
  })
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    window.synapse.bookmarks.showContextMenu('bookmark', bm.id)
  })
  wireDragItem(row, { kind: 'bookmark', id: bm.id }, {
    accepts: (d) => d.kind === 'bookmark',
    onDrop: (d, before) => {
      // a sibling drag is a reorder; a drag from another container is a
      // position-preserving move into this row's container
      const from = siblings.findIndex((s) => s.id === d.id)
      let to = index + (before ? 0 : 1)
      if (from !== -1 && from < to) to -= 1
      if (from !== -1) window.synapse.bookmarks.reorder(d.id, to)
      else window.synapse.bookmarks.moveToFolder(d.id, bm.folderId ?? null, to)
    },
  })
  return row
}

function folderRow(
  folder: BookmarkFolder,
  index: number,
  folders: BookmarkFolder[],
  count: number,
): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'panel-item folder'
  const twist = document.createElement('span')
  twist.className = 'folder-twist'
  twist.textContent = collapsed.has(folder.id) ? '▸' : '▾'
  const name = document.createElement('span')
  name.className = 'folder-name'
  name.textContent = folder.name
  const countEl = document.createElement('span')
  countEl.className = 'folder-count'
  countEl.textContent = String(count)
  row.append(twist, name, countEl)
  row.addEventListener('click', () => {
    if (collapsed.has(folder.id)) collapsed.delete(folder.id)
    else collapsed.add(folder.id)
    rerender?.()
  })
  row.addEventListener('dblclick', () => startItemEdit(folder.id))
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    window.synapse.bookmarks.showContextMenu('folder', folder.id)
  })
  wireDragItem(row, { kind: 'folder', id: folder.id }, {
    accepts: (d) => d.kind === 'folder' || d.kind === 'bookmark',
    into: (d) => d.kind === 'bookmark',
    onDrop: (d, before) => {
      if (d.kind === 'bookmark') {
        collapsed.delete(folder.id) // auto-expand so the drop is visible
        window.synapse.bookmarks.moveToFolder(d.id, folder.id)
        return
      }
      const from = folders.findIndex((f) => f.id === d.id)
      let to = index + (before ? 0 : 1)
      if (from !== -1 && from < to) to -= 1
      window.synapse.bookmarks.reorder(d.id, to)
    },
  })
  return row
}

function inlineEditor(
  value: string,
  placeholder: string,
  onCommit: (v: string) => void,
): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'panel-item folder'
  const input = document.createElement('input')
  input.className = 'folder-input'
  input.value = value
  input.placeholder = placeholder
  let done = false
  const finish = (commit: boolean): void => {
    if (done) return
    done = true
    editing = null
    const next = input.value.trim()
    if (commit && next) onCommit(next)
    // always exit edit mode locally — the ui:bookmarks-changed push then
    // repaints the committed value, and a lost push can't wedge the editor
    rerender?.()
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true)
    else if (e.key === 'Escape') finish(false)
  })
  // clicking away saves (Esc is the cancel gesture)
  input.addEventListener('blur', () => finish(true))
  row.append(input)
  queueMicrotask(() => input.focus())
  return row
}

function folderEditor(folder: BookmarkFolder | null): HTMLDivElement {
  return inlineEditor(folder?.name ?? '', 'Folder name', (name) => {
    if (folder) window.synapse.bookmarks.renameFolder(folder.id, name)
    else window.synapse.bookmarks.addFolder(name)
  })
}

function bookmarkEditor(bm: Bookmark, indented: boolean): HTMLDivElement {
  const row = inlineEditor(bm.title, 'Bookmark title', (title) =>
    window.synapse.bookmarks.rename(bm.id, title),
  )
  if (indented) row.classList.add('indent')
  return row
}
```

- [ ] **Step 2: Strip bookmarks from `panel.ts`**

Replace `src/renderer/panel.ts` with the history-only version:

```ts
export type PanelMode = 'none' | 'history'

export async function renderPanel(el: HTMLElement, mode: PanelMode): Promise<void> {
  el.innerHTML = ''
  if (mode === 'none') return
  const heading = document.createElement('div')
  heading.className = 'panel-heading'
  heading.textContent = 'History'
  el.append(heading)
  const items = await window.synapse.history.list()
  if (items.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'panel-empty'
    empty.textContent = 'No history yet'
    el.append(empty)
    return
  }
  for (const item of items) {
    const row = document.createElement('div')
    row.className = 'panel-item'
    const titleEl = document.createElement('span')
    titleEl.className = 'panel-item-title'
    titleEl.textContent = item.title || item.url
    const urlEl = document.createElement('span')
    urlEl.className = 'panel-item-url'
    urlEl.textContent = item.url
    row.append(titleEl, urlEl)
    row.addEventListener('click', () => window.synapse.tabs.create(item.url))
    el.append(row)
  }
}
```

- [ ] **Step 3: index.html — bookmark section in, ★ button out**

In `src/renderer/index.html`, the sidebar becomes:

```html
      <aside id="sidebar">
        <div id="pin-grid" hidden></div>
        <div id="bookmarks"></div>
        <div id="tab-list"></div>
        <div id="panel" hidden></div>
        <div id="sidebar-footer">
          <button id="new-tab">＋ New Tab</button>
          <button id="show-history" title="History">🕘</button>
        </div>
      </aside>
```

(The `show-bookmarks` button is deleted.)

- [ ] **Step 4: main.ts rewiring**

Replace `src/renderer/main.ts` with:

```ts
import './style.css'
import type { BookmarksData, TabsSnapshot } from '../shared/ipc'
import { renderBookmarks, startItemEdit } from './bookmarks-section'
import { PanelMode, renderPanel } from './panel'
import { renderPins, renderTabList } from './sidebar'
import { initTopbar } from './topbar'

const pinGridEl = document.getElementById('pin-grid')!
const bookmarksEl = document.getElementById('bookmarks')!
const tabListEl = document.getElementById('tab-list')!
const panelEl = document.getElementById('panel')!
const topbar = initTopbar()

let snap: TabsSnapshot = { tabs: {}, order: [], pinned: [], bookmarkTabs: {}, activeId: null }
let bookmarks: BookmarksData = { folders: [], bookmarks: [] }
let panelMode: PanelMode = 'none'

window.synapse.onTabsUpdated((s) => {
  snap = s
  render()
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
  renderPins(pinGridEl, snap)
  renderBookmarks(bookmarksEl, bookmarks, snap, render)
  renderTabList(tabListEl, snap)
  topbar.update(snap)
  const showSidebar = panelMode === 'none'
  pinGridEl.hidden = !showSidebar || snap.pinned.length === 0
  bookmarksEl.hidden = !showSidebar
  tabListEl.hidden = !showSidebar
  panelEl.hidden = showSidebar
}
```

- [ ] **Step 5: Remove `onToggleBookmarks` from the API surface**

In `src/shared/ipc.ts`, delete the `onToggleBookmarks(cb: () => void): void` line from `SynapseApi.ui`.

In `src/preload/index.ts`, delete the `onToggleBookmarks` block from `ui`.

- [ ] **Step 6: topbar — allow un-bookmarking a navigated-away bookmark tab**

In `src/renderer/topbar.ts` `update()`, replace the `canBookmark` line:

```ts
      const canBookmark = !!tab && (tab.isBookmarked || /^https?:\/\//.test(tab.url))
```

- [ ] **Step 7: Styles**

Append to `src/renderer/style.css`:

```css
#bookmarks {
  flex: none;
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
#bookmarks[hidden] {
  display: none;
}
.tab.asleep .favicon {
  opacity: 0.45;
}
.tab.indent {
  margin-left: 16px;
}
.bookmarks-loose {
  min-height: 8px;
}
```

- [ ] **Step 8: README**

In `README.md` update the two feature bullets:

- Line 8–10 pins bullet: change "share Cmd+1–9 with tabs (pins first)" to "share Cmd+1–9 with bookmarks and tabs (pins, then bookmarks, then tabs)".
- Line 14: replace with:

```markdown
- Bookmarks live in the sidebar above the tab list (Cmd+D converts the active
  tab into a bookmark and back; click to wake, × to sleep; right-click to
  rename, file into folders, or assign a Default/Work profile), History
  (Cmd+Y), Downloads to ~/Downloads
```

- [ ] **Step 9: Typecheck, tests, manual smoke**

Run: `npm run typecheck` — expected: clean.
Run: `npm test` — expected: PASS.

Run: `npm run dev` and verify:
1. Bookmark section renders between pin grid and tabs with a divider; folders collapse/expand; ＋ Folder works.
2. ⌘D converts the active tab: its row disappears from the tab list and appears in the bookmark section, highlighted active; star is filled; ⌘D again drops it back to the top of the tab list.
3. Clicking a sleeping bookmark wakes it (row highlights, favicon/loading live); × puts it back to sleep (favicon stays, dimmed).
4. Right-click a bookmark → Profile → Work: work dot appears; the tab reloads in the Work partition (site shows logged-out state); Restore Bookmarked URL appears after navigating away; Put to Sleep works.
5. Option+Tab cycles pins → awake bookmarks → tabs; Ctrl+Tab includes awake bookmarks; ⌘1–9 counts pins, then bookmarks (waking a sleeping one), then tabs.
6. Rename via double-click still works; drag reorders bookmarks and moves them into/out of folders; deleting a folder with awake members closes their views after the confirm.
7. ⌘B does nothing; the ★ footer button is gone; ⌘Y history panel still toggles.
8. Restart: bookmarks restore asleep with favicons; the previously-awake ones are not resurrected as normal tabs.

- [ ] **Step 10: Commit**

```bash
git add src/renderer src/shared/ipc.ts src/preload/index.ts README.md
git commit -m "feat: render bookmarks in the sidebar and remove the bookmarks panel"
```

---

### Task 5: Final verification

**Files:** none (verification only; fix regressions in place if found).

- [ ] **Step 1: Full check**

Run: `npm run typecheck` — expected: clean.
Run: `npm test` — expected: all suites PASS.
Run: `git log --oneline -6` — expected: the four feature commits plus spec/plan docs.

- [ ] **Step 2: Regression smoke**

Run: `npm run dev` and re-verify the pre-existing behaviors this change brushes against:
1. Pins: pin/unpin (⌘P), pin sleep/wake, pin context menu profile switch, pins persist across restart.
2. Ctrl+Tab hold-and-walk commit-on-release still works (cycle hooks untouched, but bookmark views must have them: wake a bookmark, then Ctrl+Tab from it).
3. Suggestions dropdown still shifts the page view (overlay height) and resets on close.
4. Extensions: a toolbar button popup still opens; a Work-profile bookmark tab does NOT appear in extension chrome.tabs queries (spot-check via an extension if installed).
5. Closing the last normal tab while bookmarks are all asleep spawns a fresh blank tab.

- [ ] **Step 3: Commit any fixes**

If regressions were found and fixed:

```bash
git add -A && git commit -m "fix: post-integration regressions in bookmark tabs"
```
