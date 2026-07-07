# Bookmark Folders, Reorder & Anchored Bookmark Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag-reorderable bookmarks with single-level CRUD folders, `Cmd+B` panel toggle, and pin-style "anchored" bookmark tabs restorable via `Ctrl+Cmd+H`.

**Architecture:** `bookmarks.json` bumps to a v2 schema (folders array + `folderId` on bookmarks; array order = display order) behind `BookmarksStore`. `TabManager` generalizes the pin-slot anchor URL into a per-tab anchor map so bookmark-opened tabs get `Ctrl+Cmd+H` restore and click-to-refocus. The sidebar's drag code extracts into a shared `drag-list.ts` helper reused by the rewritten bookmarks panel. All mutations are fire-and-forget IPC; main pushes `ui:bookmarks-changed` and the panel re-renders.

**Tech Stack:** Electron + electron-vite, TypeScript strict, vanilla DOM renderer (no framework), Vitest for pure logic.

**Spec:** `docs/superpowers/specs/2026-07-07-bookmark-folders-design.md`

## Global Constraints

- TypeScript strict; `npm run typecheck` (`tsc --noEmit`) must pass before any task is "done".
- No new runtime npm dependencies.
- No UI framework in the renderer — plain DOM.
- Pure logic lives in Electron-free modules with Vitest coverage; Electron-coupled code is verified by manual smoke.
- Short conventional commits (`feat:`, `fix:`, `chore:`, `test:`).
- Web page tabs get no preload/IPC; only the chrome UI sees `window.synapse` (typed as `SynapseApi` in `src/shared/ipc.ts`).
- Never register `session.webRequest`/`protocol.intercept*` on extension-hosting sessions (not touched by this plan; listed because it is a hard repo rule).
- The working tree has an uncommitted favicon `onerror` fix in `src/renderer/sidebar.ts` (lines shown in Task 6's code) — preserve it; do not revert it.

---

### Task 1: Bookmarks store v2 schema + migration

**Files:**
- Modify: `src/shared/ipc.ts:38-42` (Bookmark type; add BookmarkFolder, BookmarksData)
- Modify: `src/main/bookmarks.ts` (full rewrite)
- Modify: `src/main/index.ts:176` (keep `bookmarks:list` returning a flat array for now)
- Test: `tests/bookmarks.test.ts`

**Interfaces:**
- Consumes: `JsonStore` from `src/main/store.ts` (existing).
- Produces: shared types `BookmarkFolder { id, name }`, `Bookmark { id, url, title, createdAt, folderId? }`, `BookmarksData { folders, bookmarks }`; `BookmarksStore.list(): BookmarksData`, `.remove(id: string): void`, `.toggle(url, title, createdAt): boolean` (unchanged signature), `.isBookmarked(url): boolean` (unchanged). Later tasks (2, 3, 6) extend this class.

- [ ] **Step 1: Update shared types**

In `src/shared/ipc.ts`, replace the `Bookmark` interface (currently lines 38-42) with:

```ts
export interface BookmarkFolder {
  id: string
  name: string
}

export interface Bookmark {
  id: string
  url: string
  title: string
  createdAt: number
  folderId?: string // absent = top level
}

export interface BookmarksData {
  folders: BookmarkFolder[]
  bookmarks: Bookmark[]
}
```

Leave `SynapseApi.bookmarks` untouched in this task (still `list(): Promise<Bookmark[]>`).

- [ ] **Step 2: Write the failing tests**

Replace `tests/bookmarks.test.ts` with:

```ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BookmarksStore } from '../src/main/bookmarks'

describe('BookmarksStore', () => {
  let dir: string
  let store: BookmarksStore

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-'))
    store = new BookmarksStore(dir)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('toggle adds a bookmark with an id and returns true', () => {
    expect(store.toggle('https://a.com', 'A', 1)).toBe(true)
    expect(store.isBookmarked('https://a.com')).toBe(true)
    const { bookmarks } = store.list()
    expect(bookmarks).toHaveLength(1)
    expect(bookmarks[0]!.id).toBeTruthy()
    expect(bookmarks[0]!.folderId).toBeUndefined()
  })

  it('toggle removes an existing bookmark and returns false', () => {
    store.toggle('https://a.com', 'A', 1)
    expect(store.toggle('https://a.com', 'A', 2)).toBe(false)
    expect(store.isBookmarked('https://a.com')).toBe(false)
    expect(store.list().bookmarks).toEqual([])
  })

  it('new bookmarks land at the top of the top level', () => {
    store.toggle('https://a.com', 'A', 1)
    store.toggle('https://b.com', 'B', 2)
    expect(store.list().bookmarks.map((b) => b.url)).toEqual(['https://b.com', 'https://a.com'])
  })

  it('remove deletes by id', () => {
    store.toggle('https://a.com', 'A', 1)
    store.toggle('https://b.com', 'B', 2)
    const id = store.list().bookmarks.find((b) => b.url === 'https://a.com')!.id
    store.remove(id)
    expect(store.list().bookmarks.map((b) => b.url)).toEqual(['https://b.com'])
  })

  it('migrates a v1 file: stamps ids, adds empty folders', () => {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'bookmarks.json'),
      JSON.stringify({
        v: 1,
        bookmarks: [{ url: 'https://old.com', title: 'Old', createdAt: 5 }],
      }),
    )
    const migrated = new BookmarksStore(dir)
    const { folders, bookmarks } = migrated.list()
    expect(folders).toEqual([])
    expect(bookmarks).toHaveLength(1)
    expect(bookmarks[0]!.url).toBe('https://old.com')
    expect(bookmarks[0]!.id).toBeTruthy()
  })

  it('persists via flush and reloads', () => {
    store.toggle('https://a.com', 'A', 1)
    store.flush()
    const reloaded = new BookmarksStore(dir)
    expect(reloaded.isBookmarked('https://a.com')).toBe(true)
    expect(reloaded.list().bookmarks[0]!.id).toBe(store.list().bookmarks[0]!.id)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/bookmarks.test.ts`
Expected: FAIL — `store.list().bookmarks` is undefined (v1 `list()` returns an array), `remove` does not exist.

- [ ] **Step 4: Rewrite the store**

Replace `src/main/bookmarks.ts` with:

```ts
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import type { Bookmark, BookmarkFolder, BookmarksData } from '../shared/ipc'
import { JsonStore } from './store'

interface BookmarksFileV1 {
  v: 1
  bookmarks: { url: string; title: string; createdAt: number }[]
}

interface BookmarksFileV2 {
  v: 2
  folders: BookmarkFolder[]
  bookmarks: Bookmark[]
}

type BookmarksFile = BookmarksFileV1 | BookmarksFileV2

export class BookmarksStore {
  private store: JsonStore<BookmarksFile>

  constructor(dir: string) {
    this.store = new JsonStore<BookmarksFile>(path.join(dir, 'bookmarks.json'), {
      v: 2,
      folders: [],
      bookmarks: [],
    })
    const data = this.store.get()
    if (data.v === 1) {
      // v1 carried a flat list without ids or folders
      this.store.set({
        v: 2,
        folders: [],
        bookmarks: data.bookmarks.map((b) => ({ ...b, id: randomUUID() })),
      })
    }
  }

  // the constructor migrates v1 files, so reads are always v2
  private get data(): BookmarksFileV2 {
    return this.store.get() as BookmarksFileV2
  }

  isBookmarked(url: string): boolean {
    return this.data.bookmarks.some((b) => b.url === url)
  }

  toggle(url: string, title: string, createdAt: number): boolean {
    const { folders, bookmarks } = this.data
    if (this.isBookmarked(url)) {
      this.store.set({ v: 2, folders, bookmarks: bookmarks.filter((b) => b.url !== url) })
      return false
    }
    this.store.set({
      v: 2,
      folders,
      bookmarks: [{ id: randomUUID(), url, title, createdAt }, ...bookmarks],
    })
    return true
  }

  remove(id: string): void {
    const { folders, bookmarks } = this.data
    this.store.set({ v: 2, folders, bookmarks: bookmarks.filter((b) => b.id !== id) })
  }

  list(): BookmarksData {
    const { folders, bookmarks } = this.data
    return { folders, bookmarks }
  }

  flush(): void {
    this.store.flush()
  }
}
```

- [ ] **Step 5: Keep the IPC contract flat for now**

In `src/main/index.ts`, change the `bookmarks:list` handler (currently line 176) to:

```ts
  ipcMain.handle('bookmarks:list', () => bookmarks.list().bookmarks)
```

This keeps the renderer's existing `Promise<Bookmark[]>` contract working until Task 5 switches everything at once.

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/bookmarks.test.ts` — Expected: PASS (6 tests)
Run: `npm run typecheck` — Expected: clean

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/main/bookmarks.ts src/main/index.ts tests/bookmarks.test.ts
git commit -m "feat: bookmarks store v2 schema with ids and folders"
```

---

### Task 2: Folder CRUD in the store

**Files:**
- Modify: `src/main/bookmarks.ts`
- Test: `tests/bookmarks.test.ts`

**Interfaces:**
- Consumes: Task 1's `BookmarksStore` internals (`this.data`, `this.store.set`).
- Produces: `addFolder(name: string): BookmarkFolder`, `renameFolder(id: string, name: string): void`, `removeFolder(id: string): void` (deletes member bookmarks too). Task 3's tests use `addFolder`'s returned `id`; Task 5's IPC handlers call all three.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('BookmarksStore', ...)` block of `tests/bookmarks.test.ts` (the folder-with-members deletion case needs `moveToFolder` and is tested in Task 3; here we cover CRUD plus deleting alongside a top-level bookmark):

```ts
  it('addFolder appends and returns the folder', () => {
    const a = store.addFolder('Work')
    const b = store.addFolder('Play')
    expect(a.id).toBeTruthy()
    expect(store.list().folders.map((f) => f.name)).toEqual(['Work', 'Play'])
    expect(store.list().folders[1]!.id).toBe(b.id)
  })

  it('renameFolder renames in place', () => {
    const f = store.addFolder('Work')
    store.renameFolder(f.id, 'Werk')
    expect(store.list().folders).toEqual([{ id: f.id, name: 'Werk' }])
  })

  it('removeFolder removes an empty folder', () => {
    const f = store.addFolder('Work')
    store.toggle('https://out.com', 'Out', 1)
    store.removeFolder(f.id)
    expect(store.list().folders).toEqual([])
    expect(store.list().bookmarks.map((b) => b.url)).toEqual(['https://out.com'])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/bookmarks.test.ts`
Expected: FAIL — `addFolder` is not a function.

- [ ] **Step 3: Implement folder CRUD**

Add to `BookmarksStore` (after `remove`):

```ts
  addFolder(name: string): BookmarkFolder {
    const { folders, bookmarks } = this.data
    const folder = { id: randomUUID(), name }
    this.store.set({ v: 2, folders: [...folders, folder], bookmarks })
    return folder
  }

  renameFolder(id: string, name: string): void {
    const { folders, bookmarks } = this.data
    this.store.set({
      v: 2,
      folders: folders.map((f) => (f.id === id ? { ...f, name } : f)),
      bookmarks,
    })
  }

  // deleting a folder deletes its bookmarks too (confirmed UX decision)
  removeFolder(id: string): void {
    const { folders, bookmarks } = this.data
    this.store.set({
      v: 2,
      folders: folders.filter((f) => f.id !== id),
      bookmarks: bookmarks.filter((b) => b.folderId !== id),
    })
  }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/bookmarks.test.ts` — Expected: PASS (9 tests)
Run: `npm run typecheck` — Expected: clean

- [ ] **Step 5: Commit**

```bash
git add src/main/bookmarks.ts tests/bookmarks.test.ts
git commit -m "feat: bookmark folder CRUD in BookmarksStore"
```

---

### Task 3: Reorder and move-to-folder in the store

**Files:**
- Modify: `src/main/bookmarks.ts`
- Test: `tests/bookmarks.test.ts`

**Interfaces:**
- Consumes: Task 2's `addFolder`.
- Produces: `reorder(id: string, toIndex: number): void` (bookmark → container-relative; folder → folder-list index) and `moveToFolder(id: string, folderId: string | null, toIndex?: number): void` (null = top level; omitted index = append). Task 5's IPC handlers and Task 7's panel drag handlers call these.

**Semantics reminder:** a container's bookmark order is the members' *relative* order within the single global `bookmarks[]` array. Reordering inside one container must not disturb other containers' relative order.

- [ ] **Step 1: Write the failing tests**

Append inside the describe block of `tests/bookmarks.test.ts`:

```ts
  // toggle prepends, so toggling A,B,C yields order [C,B,A]; helper for clarity
  function seed(urls: string[]): string[] {
    for (const [i, url] of urls.entries()) store.toggle(url, url, i)
    const { bookmarks } = store.list()
    // return ids in the same order as `urls`
    return urls.map((u) => bookmarks.find((b) => b.url === u)!.id)
  }

  function urlsAt(folderId?: string): string[] {
    return store
      .list()
      .bookmarks.filter((b) => b.folderId === folderId)
      .map((b) => b.url)
  }

  it('reorder moves a bookmark within the top level', () => {
    seed(['a', 'b', 'c']) // top-level order: c, b, a
    const cId = store.list().bookmarks.find((b) => b.url === 'c')!.id
    store.reorder(cId, 2)
    expect(urlsAt()).toEqual(['b', 'a', 'c'])
  })

  it('reorder clamps out-of-range indices', () => {
    seed(['a', 'b'])
    const aId = store.list().bookmarks.find((b) => b.url === 'a')!.id
    store.reorder(aId, 99)
    expect(urlsAt()).toEqual(['b', 'a'])
    store.reorder(aId, -5)
    expect(urlsAt()).toEqual(['a', 'b'])
  })

  it('reorder moves a folder within the folder list', () => {
    const f1 = store.addFolder('One')
    store.addFolder('Two')
    store.addFolder('Three')
    store.reorder(f1.id, 2)
    expect(store.list().folders.map((f) => f.name)).toEqual(['Two', 'Three', 'One'])
  })

  it('moveToFolder appends when no index given', () => {
    const f = store.addFolder('F')
    const [aId, bId] = seed(['a', 'b'])
    store.moveToFolder(aId!, f.id)
    store.moveToFolder(bId!, f.id)
    expect(urlsAt(f.id)).toEqual(['a', 'b'])
    expect(urlsAt()).toEqual([])
  })

  it('moveToFolder places at a container-relative index', () => {
    const f = store.addFolder('F')
    const [aId, bId, cId] = seed(['a', 'b', 'c'])
    store.moveToFolder(aId!, f.id)
    store.moveToFolder(bId!, f.id)
    store.moveToFolder(cId!, f.id, 1) // between a and b
    expect(urlsAt(f.id)).toEqual(['a', 'c', 'b'])
  })

  it('moveToFolder(null) returns a bookmark to the top level', () => {
    const f = store.addFolder('F')
    const [aId] = seed(['a', 'b']) // top level: b, a
    store.moveToFolder(aId!, f.id)
    store.moveToFolder(aId!, null, 0)
    expect(urlsAt()).toEqual(['a', 'b'])
    expect(urlsAt(f.id)).toEqual([])
  })

  it('moveToFolder to a nonexistent folder is a no-op', () => {
    const [aId] = seed(['a'])
    store.moveToFolder(aId!, 'nope')
    expect(urlsAt()).toEqual(['a'])
    expect(store.list().bookmarks[0]!.folderId).toBeUndefined()
  })

  it('reorder inside a folder leaves other containers untouched', () => {
    const f = store.addFolder('F')
    const [aId, bId, cId] = seed(['a', 'b', 'c', 'x', 'y'])
    store.moveToFolder(aId!, f.id)
    store.moveToFolder(bId!, f.id)
    store.moveToFolder(cId!, f.id) // folder: a, b, c ; top level: y, x
    store.reorder(cId!, 0)
    expect(urlsAt(f.id)).toEqual(['c', 'a', 'b'])
    expect(urlsAt()).toEqual(['y', 'x'])
  })

  it('removeFolder deletes member bookmarks only', () => {
    const f = store.addFolder('F')
    const [aId] = seed(['a', 'b'])
    store.moveToFolder(aId!, f.id)
    store.removeFolder(f.id)
    expect(store.list().folders).toEqual([])
    expect(urlsAt()).toEqual(['b'])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/bookmarks.test.ts`
Expected: FAIL — `reorder` / `moveToFolder` are not functions.

- [ ] **Step 3: Implement**

Add to `BookmarksStore`:

```ts
  // toIndex is container-relative for bookmarks, folder-list-relative for folders
  reorder(id: string, toIndex: number): void {
    const { folders, bookmarks } = this.data
    const folderIdx = folders.findIndex((f) => f.id === id)
    if (folderIdx !== -1) {
      const next = [...folders]
      const [folder] = next.splice(folderIdx, 1)
      next.splice(Math.max(0, Math.min(Math.round(toIndex), next.length)), 0, folder!)
      this.store.set({ v: 2, folders: next, bookmarks })
      return
    }
    const bookmark = bookmarks.find((b) => b.id === id)
    if (bookmark) this.place(bookmark, bookmark.folderId, toIndex)
  }

  moveToFolder(id: string, folderId: string | null, toIndex = Number.MAX_SAFE_INTEGER): void {
    const { folders, bookmarks } = this.data
    if (folderId !== null && !folders.some((f) => f.id === folderId)) return
    const bookmark = bookmarks.find((b) => b.id === id)
    if (bookmark) this.place(bookmark, folderId ?? undefined, toIndex)
  }

  // container membership is folderId; order within a container is the members'
  // relative order in the global bookmarks array, so placing = remove + insert
  // adjacent to the member currently at the target slot
  private place(bookmark: Bookmark, folderId: string | undefined, toIndex: number): void {
    const { folders, bookmarks } = this.data
    const rest = bookmarks.filter((b) => b.id !== bookmark.id)
    const moved: Bookmark = { ...bookmark }
    if (folderId === undefined) delete moved.folderId
    else moved.folderId = folderId
    const members = rest.filter((b) => b.folderId === folderId)
    const clamped = Math.max(0, Math.min(Math.round(toIndex), members.length))
    const insertAt =
      clamped >= members.length
        ? members.length === 0
          ? rest.length
          : rest.indexOf(members[members.length - 1]!) + 1
        : rest.indexOf(members[clamped]!)
    rest.splice(insertAt, 0, moved)
    this.store.set({ v: 2, folders, bookmarks: rest })
  }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/bookmarks.test.ts` — Expected: PASS (18 tests)
Run: `npm run typecheck` — Expected: clean

- [ ] **Step 5: Commit**

```bash
git add src/main/bookmarks.ts tests/bookmarks.test.ts
git commit -m "feat: bookmark reorder and move-to-folder"
```

---

### Task 4: Anchored tabs in TabManager + persistence + shortcuts

**Files:**
- Modify: `src/main/tabs-store.ts` (optional `anchor` on `TabEntry`)
- Modify: `src/shared/ipc.ts` (rename `TabInfo.pinnedUrl` → `anchorUrl`)
- Modify: `src/main/tab-manager.ts` (anchors map, `openBookmark`, `restoreAnchor`, `isAnchored`, snapshot, `restoreTabs`, `closeTab` cleanup)
- Modify: `src/main/menu.ts` (relabel restore item; `Cmd+B` accelerator)
- Modify: `src/main/index.ts` (persist anchors; context-menu restore item)
- Test: `tests/tabs-store.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-3 (independent).
- Produces: `TabEntry { url, profile, anchor? }`; `TabManager.openBookmark(url: string): void`, `restoreAnchor(id?: string | null): void` (replaces `restorePinnedUrl`), `isAnchored(id: string): boolean`; `TabInfo.anchorUrl: string | null` (replaces `pinnedUrl`); `restoreTabs(tabs: { url: string; profile: ProfileId; anchor?: string }[], active: number)`. Task 5's `bookmarks:open` handler calls `openBookmark`.

- [ ] **Step 1: Write the failing tabs-store tests**

Append inside the existing `describe('TabsStore', ...)` block of `tests/tabs-store.test.ts` (the file already imports `fs`/`path`/`TabsStore`; each test constructs its own `store` from the shared `dir` — match that):

```ts
  it('round-trips a bookmark anchor', () => {
    const store = new TabsStore(dir)
    store.save(
      [{ url: 'https://a.test/deep', profile: 'default', anchor: 'https://a.test/' }],
      0,
    )
    store.flush()
    expect(new TabsStore(dir).load().tabs[0]!.anchor).toBe('https://a.test/')
  })

  it('drops non-http anchors on save and load', () => {
    const store = new TabsStore(dir)
    store.save([{ url: 'https://a.test/', profile: 'default', anchor: 'about:blank' }], 0)
    store.flush()
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'tabs.json'), 'utf8'))
    expect('anchor' in raw.tabs[0]).toBe(false)
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({
        v: 2,
        tabs: [{ url: 'https://a.test/', profile: 'default', anchor: 42 }],
        active: 0,
      }),
    )
    expect(new TabsStore(dir).load().tabs[0]!.anchor).toBeUndefined()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tabs-store.test.ts`
Expected: FAIL — `anchor` is not in `TabEntry` (typecheck error at test compile) / round-trip loses the field.

- [ ] **Step 3: Extend TabsStore**

In `src/main/tabs-store.ts`:

```ts
export interface TabEntry {
  url: string
  profile: ProfileId
  anchor?: string // bookmark anchor url; Ctrl+Cmd+H restores the tab to it
}
```

Update `save` (only the mapper changes):

```ts
  save(tabs: TabEntry[], active: number): void {
    this.store.set({
      v: 2,
      tabs: tabs.map((t) => ({
        url: PERSISTABLE.test(t.url) ? t.url : '',
        profile: t.profile,
        ...(t.anchor && PERSISTABLE.test(t.anchor) ? { anchor: t.anchor } : {}),
      })),
      active,
    })
  }
```

Update the `clean` mapper in `load` (the returned object):

```ts
      const { url, profile, anchor } = t as { url?: unknown; profile?: unknown; anchor?: unknown }
      if (typeof url !== 'string') return []
      return [
        {
          url,
          profile: profile === 'work' ? 'work' : 'default',
          ...(typeof anchor === 'string' && PERSISTABLE.test(anchor) ? { anchor } : {}),
        },
      ]
```

- [ ] **Step 4: Run tabs-store tests**

Run: `npx vitest run tests/tabs-store.test.ts` — Expected: PASS

- [ ] **Step 5: Rename `TabInfo.pinnedUrl` → `anchorUrl` and add anchors to TabManager**

In `src/shared/ipc.ts`, in `TabInfo` replace `pinnedUrl: string | null` with:

```ts
  anchorUrl: string | null
```

In `src/main/tab-manager.ts`:

(a) Add the map next to the other fields (after `private profiles = ...`, line 24):

```ts
  private anchors = new Map<string, string>()
```

(b) In `closeTab`, next to `this.profiles.delete(id)` (line 82):

```ts
    this.anchors.delete(id)
```

(c) Replace `restorePinnedUrl` (lines 213-217) with:

```ts
  // open a bookmark pin-style: refocus the tab already carrying it, else
  // create one anchored to it. Pinned slots win over anchors when both match.
  openBookmark(url: string): void {
    for (const [id, slot] of this.pins) {
      if (slot.url === url) return this.activateTab(id)
    }
    for (const [id, anchor] of this.anchors) {
      if (anchor === url) return this.activateTab(id)
    }
    const id = this.createTab(url)
    this.anchors.set(id, url)
    this.refresh()
  }

  restoreAnchor(id: string | null = this.model.activeId): void {
    if (!id) return
    const url = this.pins.get(id)?.url ?? this.anchors.get(id)
    if (url) this.views.get(id)?.webContents.loadURL(url)
  }

  isAnchored(id: string): boolean {
    return this.anchors.has(id)
  }
```

(d) In `restoreTabs` (lines 145-152), change the signature and the map callback:

```ts
  // recreate a saved session: tabs in sidebar order, then the active one
  restoreTabs(tabs: { url: string; profile: ProfileId; anchor?: string }[], active: number): void {
    if (tabs.length === 0) {
      this.createTab()
      return
    }
    const ids = tabs.map((t) => {
      const id = this.createTab(t.url || undefined, false, t.profile)
      if (t.anchor) this.anchors.set(id, t.anchor)
      return id
    })
    this.activateTab(ids[Math.min(Math.max(active, 0), ids.length - 1)]!)
  }
```

(e) In `snapshot()`, replace `pinnedUrl: slot?.url ?? null` (awake branch, line 324) with:

```ts
          anchorUrl: slot?.url ?? this.anchors.get(id) ?? null,
```

and `pinnedUrl: slot.url` (asleep branch, line 339) with:

```ts
          anchorUrl: slot.url,
```

- [ ] **Step 6: Update menu.ts**

In `src/main/menu.ts`:

Replace the restore item (lines 70-74):

```ts
        {
          label: 'Restore Pinned/Bookmarked URL',
          accelerator: 'Control+CmdOrCtrl+H',
          click: () => tabs.restoreAnchor(),
        },
```

Change the Bookmarks accelerator (line 93) from `'CmdOrCtrl+Shift+B'` to:

```ts
          accelerator: 'CmdOrCtrl+B',
```

- [ ] **Step 7: Update index.ts persistence and tab context menu**

In `src/main/index.ts`:

(a) `onSnapshot` — persist anchors and use the renamed field (replace lines 74-85):

```ts
      tabsStore.save(
        snap.order.map((id) => {
          const t = snap.tabs[id]!
          return { url: t.url, profile: t.profile, ...(t.anchorUrl ? { anchor: t.anchorUrl } : {}) }
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
```

(b) In the `tabs:context-menu` handler, replace the pinned-restore block (lines 137-139):

```ts
    if (pinned && tabs.isAwake(id)) {
      template.push({ label: 'Restore Pinned URL', click: () => tabs.restoreAnchor(id) })
    } else if (tabs.isAnchored(id)) {
      template.push({ label: 'Restore Bookmarked URL', click: () => tabs.restoreAnchor(id) })
    }
```

- [ ] **Step 8: Full test run and typecheck**

Run: `npm test` — Expected: PASS (all suites)
Run: `npm run typecheck` — Expected: clean (this catches any remaining `pinnedUrl`/`restorePinnedUrl` references)

- [ ] **Step 9: Commit**

```bash
git add src/shared/ipc.ts src/main/tabs-store.ts src/main/tab-manager.ts src/main/menu.ts src/main/index.ts tests/tabs-store.test.ts
git commit -m "feat: anchored bookmark tabs with Ctrl+Cmd+H restore and Cmd+B"
```

---

### Task 5: Bookmarks IPC surface (preload, SynapseApi, main handlers)

**Files:**
- Modify: `src/shared/ipc.ts` (`SynapseApi.bookmarks` + `ui` listeners)
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts` (handlers, `bookmarksChanged`, confirm dialog, context menu)
- Modify: `src/renderer/main.ts` (re-render on push)
- Modify: `src/renderer/panel.ts` (minimal adaptation to `BookmarksData` shape)

**Interfaces:**
- Consumes: Tasks 1-3 store methods; Task 4's `tabs.openBookmark`.
- Produces: the full `window.synapse.bookmarks` API and `ui:bookmarks-changed` / `ui:edit-folder` pushes that Task 7's panel uses. Exact renderer-facing API:

```ts
bookmarks: {
  toggleActive(): Promise<void>
  list(): Promise<BookmarksData>
  open(id: string): void
  remove(id: string): void
  reorder(id: string, toIndex: number): void
  moveToFolder(id: string, folderId: string | null, toIndex?: number): void
  addFolder(name: string): void
  renameFolder(id: string, name: string): void
  removeFolder(id: string): void
  showContextMenu(kind: 'bookmark' | 'folder', id: string): void
}
ui: {
  // ...existing members...
  onBookmarksChanged(cb: () => void): void
  onEditFolder(cb: (folderId: string) => void): void
}
```

- [ ] **Step 1: Update `SynapseApi` in `src/shared/ipc.ts`**

Replace the `bookmarks` block (currently `toggleActive` + `list`) with the interface shown above (import nothing new — `BookmarksData` is already exported), and add the two `ui` members after `onToggleBookmarks`.

- [ ] **Step 2: Update the preload**

In `src/preload/index.ts`, replace the `bookmarks` section:

```ts
  bookmarks: {
    toggleActive: () => ipcRenderer.invoke('bookmarks:toggle-active'),
    list: () => ipcRenderer.invoke('bookmarks:list'),
    open: (id) => ipcRenderer.send('bookmarks:open', id),
    remove: (id) => ipcRenderer.send('bookmarks:remove', id),
    reorder: (id, toIndex) => ipcRenderer.send('bookmarks:reorder', id, toIndex),
    moveToFolder: (id, folderId, toIndex) =>
      ipcRenderer.send('bookmarks:move-to-folder', id, folderId, toIndex),
    addFolder: (name) => ipcRenderer.send('bookmarks:add-folder', name),
    renameFolder: (id, name) => ipcRenderer.send('bookmarks:rename-folder', id, name),
    removeFolder: (id) => ipcRenderer.send('bookmarks:remove-folder', id),
    showContextMenu: (kind, id) => ipcRenderer.send('bookmarks:context-menu', kind, id),
  },
```

and add to the `ui` section:

```ts
    onBookmarksChanged: (cb) => {
      ipcRenderer.on('ui:bookmarks-changed', () => cb())
    },
    onEditFolder: (cb) => {
      ipcRenderer.on('ui:edit-folder', (_e, folderId) => cb(folderId))
    },
```

- [ ] **Step 3: Rewrite the bookmark handlers in `src/main/index.ts`**

Add `dialog` to the electron import (line 1):

```ts
import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron'
```

Replace the current bookmark block (lines 169-176: `toggleBookmark`, the two handles) with:

```ts
  const bookmarksChanged = (): void => {
    // isBookmarked on tab snapshots (star state) may have changed
    tabs.refresh()
    win.webContents.send('ui:bookmarks-changed')
  }

  const toggleBookmark = (): void => {
    const info = tabs.activeInfo()
    if (!info || !/^https?:\/\//.test(info.url)) return
    bookmarks.toggle(info.url, info.title, Date.now())
    bookmarksChanged()
  }
  ipcMain.handle('bookmarks:toggle-active', () => toggleBookmark())
  ipcMain.handle('bookmarks:list', () => bookmarks.list())

  ipcMain.on('bookmarks:open', (_e, id: string) => {
    const bm = bookmarks.list().bookmarks.find((b) => b.id === id)
    if (bm) tabs.openBookmark(bm.url)
  })
  ipcMain.on('bookmarks:remove', (_e, id: string) => {
    if (typeof id !== 'string') return
    bookmarks.remove(id)
    bookmarksChanged()
  })
  ipcMain.on('bookmarks:reorder', (_e, id: string, toIndex: number) => {
    if (typeof id !== 'string' || !Number.isFinite(Number(toIndex))) return
    bookmarks.reorder(id, Number(toIndex))
    bookmarksChanged()
  })
  ipcMain.on(
    'bookmarks:move-to-folder',
    (_e, id: string, folderId: string | null, toIndex?: number) => {
      if (typeof id !== 'string') return
      if (folderId !== null && typeof folderId !== 'string') return
      const idx = toIndex === undefined ? undefined : Number(toIndex)
      if (idx !== undefined && !Number.isFinite(idx)) return
      bookmarks.moveToFolder(id, folderId, idx)
      bookmarksChanged()
    },
  )
  ipcMain.on('bookmarks:add-folder', (_e, name: string) => {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) return
    bookmarks.addFolder(trimmed)
    bookmarksChanged()
  })
  ipcMain.on('bookmarks:rename-folder', (_e, id: string, name: string) => {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (typeof id !== 'string' || !trimmed) return
    bookmarks.renameFolder(id, trimmed)
    bookmarksChanged()
  })

  // deleting a non-empty folder destroys its bookmarks and has no undo
  const removeFolderWithConfirm = async (folderId: string): Promise<void> => {
    const { folders, bookmarks: all } = bookmarks.list()
    const folder = folders.find((f) => f.id === folderId)
    if (!folder) return
    const count = all.filter((b) => b.folderId === folderId).length
    if (count > 0) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Delete', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Delete “${folder.name}” and its ${count} bookmark${count === 1 ? '' : 's'}?`,
      })
      if (response !== 0) return
    }
    bookmarks.removeFolder(folderId)
    bookmarksChanged()
  }
  ipcMain.on('bookmarks:remove-folder', (_e, id: string) => {
    if (typeof id === 'string') void removeFolderWithConfirm(id)
  })

  ipcMain.on('bookmarks:context-menu', (_e, kind: string, id: string) => {
    if (typeof id !== 'string') return
    if (kind === 'folder') {
      Menu.buildFromTemplate([
        { label: 'Rename', click: () => win.webContents.send('ui:edit-folder', id) },
        { label: 'Delete Folder…', click: () => void removeFolderWithConfirm(id) },
      ]).popup({ window: win })
    } else if (kind === 'bookmark') {
      const { folders, bookmarks: all } = bookmarks.list()
      const bm = all.find((b) => b.id === id)
      if (!bm) return
      const moveTo = (folderId: string | null) => () => {
        bookmarks.moveToFolder(id, folderId)
        bookmarksChanged()
      }
      Menu.buildFromTemplate([
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
          label: 'Delete Bookmark',
          click: () => {
            bookmarks.remove(id)
            bookmarksChanged()
          },
        },
      ]).popup({ window: win })
    }
  })
```

- [ ] **Step 4: Renderer minimal adaptation**

In `src/renderer/panel.ts`, the bookmarks branch of the item fetch (line 12-13) breaks because `list()` now returns `BookmarksData`. Minimal fix so the app keeps working until Task 7's rewrite — replace the `items` assignment:

```ts
  const items =
    mode === 'history'
      ? await window.synapse.history.list()
      : (await window.synapse.bookmarks.list()).bookmarks
```

And replace the row click handler so bookmark rows use pin-style open (history rows keep `tabs.create`):

```ts
    row.addEventListener('click', () =>
      'id' in item ? window.synapse.bookmarks.open(item.id) : window.synapse.tabs.create(item.url),
    )
```

In `src/renderer/main.ts`, after the `onToggleBookmarks` line (line 24), add:

```ts
window.synapse.ui.onBookmarksChanged(() => {
  if (panelMode === 'bookmarks') void renderPanel(panelEl, panelMode)
})
```

(`onEditFolder` wiring lands in Task 7 together with the panel's inline editor.)

- [ ] **Step 5: Typecheck, tests, manual smoke**

Run: `npm run typecheck` — Expected: clean
Run: `npm test` — Expected: PASS
Smoke (`npm run dev`): `Cmd+D` a page → star fills; open panel via `Cmd+B` → bookmark listed; click it → refocuses/creates the anchored tab; `Cmd+D` with panel open → panel updates live.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/index.ts src/renderer/main.ts src/renderer/panel.ts
git commit -m "feat: bookmarks IPC surface with folders, context menu, change push"
```

---

### Task 6: Extract shared drag helper, refactor sidebar

**Files:**
- Create: `src/renderer/drag-list.ts`
- Modify: `src/renderer/sidebar.ts` (use the helper; NO behavior change)

**Interfaces:**
- Consumes: nothing new.
- Produces: `DragItem { kind: string; id: string }`, `wireDragItem(el, self, opts)` with `opts: { vertical?: boolean; accepts(d): boolean; into?(d): boolean; onDrop(d, before: boolean): void }`, and `wireDropZone(el, { accepts(d): boolean; onDrop(d): void })`. Task 7's panel uses all of these.

- [ ] **Step 1: Create `src/renderer/drag-list.ts`**

```ts
// Shared HTML5 drag-and-drop helper for the sidebar lists and the bookmarks
// panel. One drag runs at a time; `accepts` decides which targets react.
export interface DragItem {
  kind: string
  id: string
}

let drag: DragItem | null = null
const wiredZones = new WeakSet<HTMLElement>()

export function clearIndicators(): void {
  for (const el of document.querySelectorAll('.drop-before, .drop-after, .drop-into')) {
    el.classList.remove('drop-before', 'drop-after', 'drop-into')
  }
}

// vertical lists split rows top/bottom; horizontal (pin grid) splits left/right
function isBefore(e: DragEvent, el: HTMLElement, vertical: boolean): boolean {
  const r = el.getBoundingClientRect()
  return vertical ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2
}

export interface DragItemOpts {
  vertical?: boolean // default true
  accepts(drag: DragItem): boolean
  // when true for a drag, it drops INTO this element (e.g. a folder row)
  // instead of before/after it
  into?(drag: DragItem): boolean
  onDrop(drag: DragItem, before: boolean): void
}

export function wireDragItem(el: HTMLElement, self: DragItem, opts: DragItemOpts): void {
  el.draggable = true
  el.addEventListener('dragstart', (e) => {
    drag = self
    e.dataTransfer?.setData('text/plain', self.id)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  })
  el.addEventListener('dragend', () => {
    drag = null
    clearIndicators()
  })
  el.addEventListener('dragover', (e) => {
    if (!drag || drag.id === self.id || !opts.accepts(drag)) return
    e.preventDefault()
    clearIndicators()
    if (opts.into?.(drag)) el.classList.add('drop-into')
    else el.classList.add(isBefore(e, el, opts.vertical ?? true) ? 'drop-before' : 'drop-after')
  })
  el.addEventListener('drop', (e) => {
    if (!drag || drag.id === self.id || !opts.accepts(drag)) return
    e.preventDefault()
    e.stopPropagation() // containers would otherwise treat this as an append
    opts.onDrop(drag, opts.into?.(drag) ? false : isBefore(e, el, opts.vertical ?? true))
    drag = null
    clearIndicators()
  })
}

// dropping on a container's empty space (below the rows) appends
export function wireDropZone(
  el: HTMLElement,
  opts: { accepts(drag: DragItem): boolean; onDrop(drag: DragItem): void },
): void {
  if (wiredZones.has(el)) return
  wiredZones.add(el)
  el.addEventListener('dragover', (e) => {
    if (drag && opts.accepts(drag)) e.preventDefault()
  })
  el.addEventListener('drop', (e) => {
    if (!drag || !opts.accepts(drag)) return
    e.preventDefault()
    opts.onDrop(drag)
    drag = null
    clearIndicators()
  })
}
```

- [ ] **Step 2: Refactor `src/renderer/sidebar.ts`**

Replace the whole file with (note: this PRESERVES the uncommitted `icon.onerror` lines):

```ts
import type { TabsSnapshot } from '../shared/ipc'
import { wireDragItem, wireDropZone } from './drag-list'

// the tab-list container is wired once but order changes every render
let lastOrder: string[] = []

export function renderPins(el: HTMLElement, snap: TabsSnapshot): void {
  el.innerHTML = ''
  // n ≤ 4 pins each take 1/n of the row; past 4 it's a fixed 4-column grid
  el.style.gridTemplateColumns = `repeat(${Math.min(Math.max(snap.pinned.length, 1), 4)}, 1fr)`
  snap.pinned.forEach((id, i) => {
    const tab = snap.tabs[id]!
    const btn = document.createElement('button')
    btn.className =
      'pin' +
      (id === snap.activeId ? ' active' : '') +
      (tab.isAsleep ? ' asleep' : '') +
      (tab.profile === 'work' ? ' work' : '')
    btn.title = tab.title

    const icon = document.createElement('img')
    icon.className = 'favicon'
    icon.onerror = () => (icon.style.visibility = 'hidden')
    if (tab.favicon) icon.src = tab.favicon
    else icon.style.visibility = 'hidden'

    btn.append(icon)
    btn.addEventListener('click', () => window.synapse.tabs.activate(id))
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      window.synapse.tabs.showContextMenu(id)
    })
    wireDragItem(btn, { kind: 'pin', id }, {
      vertical: false,
      accepts: (d) => d.kind === 'pin',
      onDrop: (d, before) => {
        const from = snap.pinned.indexOf(d.id)
        let to = i + (before ? 0 : 1)
        if (from !== -1 && from < to) to -= 1
        window.synapse.tabs.reorder(d.id, to)
      },
    })
    el.append(btn)
  })
}

export function renderTabList(el: HTMLElement, snap: TabsSnapshot): void {
  wireDropZone(el, {
    accepts: (d) => d.kind === 'tab',
    onDrop: (d) => window.synapse.tabs.reorder(d.id, lastOrder.length - 1),
  })
  lastOrder = snap.order
  el.innerHTML = ''
  snap.order.forEach((id, i) => {
    const tab = snap.tabs[id]!
    const item = document.createElement('div')
    item.className = 'tab' + (id === snap.activeId ? ' active' : '')

    const icon = document.createElement('img')
    icon.className = 'favicon'
    icon.onerror = () => (icon.style.visibility = 'hidden')
    if (tab.favicon) icon.src = tab.favicon
    else icon.style.visibility = 'hidden'

    const title = document.createElement('span')
    title.className = 'tab-title'
    title.textContent = tab.title
    if (tab.isLoading) title.textContent = `… ${tab.title}`

    const close = document.createElement('button')
    close.className = 'tab-close'
    close.textContent = '×'
    close.title = 'Close tab'
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      window.synapse.tabs.close(id)
    })

    if (tab.profile === 'work') {
      const dot = document.createElement('span')
      dot.className = 'profile-dot'
      dot.title = 'Work profile'
      item.append(icon, title, dot, close)
    } else {
      item.append(icon, title, close)
    }
    item.addEventListener('click', () => window.synapse.tabs.activate(id))
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      window.synapse.tabs.showContextMenu(id)
    })
    wireDragItem(item, { kind: 'tab', id }, {
      accepts: (d) => d.kind === 'tab',
      onDrop: (d, before) => {
        const from = snap.order.indexOf(d.id)
        let to = i + (before ? 0 : 1)
        if (from !== -1 && from < to) to -= 1
        window.synapse.tabs.reorder(d.id, to)
      },
    })
    el.append(item)
  })
}
```

Note: the original file's `tab.isBookmarked`-free rendering and the `snap.tabs[id]` non-null assertions match the original behavior; the only intended diffs vs. the committed file are (1) the drag code goes through the helper, (2) the two `icon.onerror` lines that are already in the working tree.

- [ ] **Step 3: Typecheck and smoke drag behavior**

Run: `npm run typecheck` — Expected: clean
Smoke (`npm run dev`): drag tabs up/down the list (indicator lines appear, order commits), drag pins left/right, drop a tab on empty space below the list → moves to end. Behavior must be identical to before.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/drag-list.ts src/renderer/sidebar.ts
git commit -m "refactor: extract shared drag-list helper from sidebar"
```

---

### Task 7: Bookmarks panel rewrite (folders UI, inline editing, drag & drop)

**Files:**
- Modify: `src/renderer/panel.ts` (full rewrite)
- Modify: `src/renderer/main.ts` (wire `onEditFolder`)
- Modify: `src/renderer/style.css` (folder/indicator/editor styles)

**Interfaces:**
- Consumes: Task 5's `window.synapse.bookmarks` API + `ui.onEditFolder`; Task 6's `wireDragItem`/`wireDropZone`; existing CSS classes `panel-heading`, `panel-item`, `panel-item-title`, `panel-item-url`, `panel-empty`.
- Produces: `renderPanel(el, mode)` (same signature as today) and `startFolderEdit(folderId: string): void` (new export used by `main.ts`).

- [ ] **Step 1: Rewrite `src/renderer/panel.ts`**

```ts
import type { Bookmark, BookmarkFolder } from '../shared/ipc'
import { wireDragItem, wireDropZone } from './drag-list'

export type PanelMode = 'none' | 'history' | 'bookmarks'

const collapsed = new Set<string>()
// folder id being renamed, 'new' while naming a new folder, null when idle
let editing: string | null = null
let rerender: (() => void) | null = null

export function startFolderEdit(folderId: string): void {
  editing = folderId
  rerender?.()
}

export async function renderPanel(el: HTMLElement, mode: PanelMode): Promise<void> {
  rerender = mode === 'bookmarks' ? () => void renderPanel(el, mode) : null
  el.innerHTML = ''
  if (mode === 'none') return
  if (mode === 'history') return renderHistory(el)
  return renderBookmarks(el)
}

async function renderHistory(el: HTMLElement): Promise<void> {
  const heading = document.createElement('div')
  heading.className = 'panel-heading'
  heading.textContent = 'History'
  el.append(heading)
  const items = await window.synapse.history.list()
  if (items.length === 0) return renderEmpty(el, 'No history yet')
  for (const item of items) {
    const row = itemRow(item.title, item.url)
    row.addEventListener('click', () => window.synapse.tabs.create(item.url))
    el.append(row)
  }
}

async function renderBookmarks(el: HTMLElement): Promise<void> {
  const { folders, bookmarks } = await window.synapse.bookmarks.list()

  const heading = document.createElement('div')
  heading.className = 'panel-heading'
  const label = document.createElement('span')
  label.textContent = 'Bookmarks'
  const newFolder = document.createElement('button')
  newFolder.className = 'panel-action'
  newFolder.textContent = '＋ Folder'
  newFolder.title = 'New Folder'
  newFolder.addEventListener('click', () => {
    editing = 'new'
    rerender?.()
  })
  heading.append(label, newFolder)
  el.append(heading)

  if (folders.length === 0 && bookmarks.length === 0 && editing !== 'new') {
    return renderEmpty(el, 'No bookmarks yet')
  }

  if (editing === 'new') el.append(folderEditor(null))

  folders.forEach((folder, i) => {
    if (editing === folder.id) {
      el.append(folderEditor(folder))
      return
    }
    const members = bookmarks.filter((b) => b.folderId === folder.id)
    el.append(folderRow(folder, i, folders, members.length))
    if (!collapsed.has(folder.id)) {
      members.forEach((bm, j) => el.append(bookmarkRow(bm, j, members, true)))
    }
  })

  const topLevel = bookmarks.filter((b) => !b.folderId)
  if (folders.length > 0 && topLevel.length > 0) {
    const divider = document.createElement('div')
    divider.className = 'panel-divider'
    el.append(divider)
  }

  // loose bookmarks get their own container so its empty space below the
  // rows is a "move to top level" drop target
  const loose = document.createElement('div')
  loose.className = 'panel-loose'
  topLevel.forEach((bm, j) => loose.append(bookmarkRow(bm, j, topLevel, false)))
  wireDropZone(loose, {
    accepts: (d) => d.kind === 'bookmark',
    onDrop: (d) => window.synapse.bookmarks.moveToFolder(d.id, null),
  })
  el.append(loose)
}

function renderEmpty(el: HTMLElement, text: string): void {
  const empty = document.createElement('div')
  empty.className = 'panel-empty'
  empty.textContent = text
  el.append(empty)
}

function itemRow(title: string, url: string): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'panel-item'
  const titleEl = document.createElement('span')
  titleEl.className = 'panel-item-title'
  titleEl.textContent = title || url
  const urlEl = document.createElement('span')
  urlEl.className = 'panel-item-url'
  urlEl.textContent = url
  row.append(titleEl, urlEl)
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
  row.addEventListener('dblclick', () => startFolderEdit(folder.id))
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

function bookmarkRow(
  bm: Bookmark,
  index: number,
  siblings: Bookmark[],
  indented: boolean,
): HTMLDivElement {
  const row = itemRow(bm.title, bm.url)
  if (indented) row.classList.add('indent')
  row.addEventListener('click', () => window.synapse.bookmarks.open(bm.id))
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

function folderEditor(folder: BookmarkFolder | null): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'panel-item folder'
  const input = document.createElement('input')
  input.className = 'folder-input'
  input.value = folder?.name ?? ''
  input.placeholder = 'Folder name'
  let done = false
  const finish = (commit: boolean): void => {
    if (done) return
    done = true
    editing = null
    const name = input.value.trim()
    if (commit && name) {
      // the re-render arrives via ui:bookmarks-changed
      if (folder) window.synapse.bookmarks.renameFolder(folder.id, name)
      else window.synapse.bookmarks.addFolder(name)
    } else {
      rerender?.()
    }
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true)
    else if (e.key === 'Escape') finish(false)
  })
  input.addEventListener('blur', () => finish(false))
  row.append(input)
  queueMicrotask(() => input.focus())
  return row
}
```

- [ ] **Step 2: Wire `onEditFolder` in `src/renderer/main.ts`**

Change the panel import (line 3) to:

```ts
import { PanelMode, renderPanel, startFolderEdit } from './panel'
```

After the `onBookmarksChanged` wiring added in Task 5, add:

```ts
window.synapse.ui.onEditFolder((id) => {
  if (panelMode === 'bookmarks') startFolderEdit(id)
})
```

- [ ] **Step 3: Add CSS**

Append to `src/renderer/style.css`:

```css
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-action {
  background: none;
  border: none;
  color: var(--fg-dim);
  font-size: 11px;
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
}
.panel-action:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--fg);
}
.panel-item.folder {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.folder-twist {
  color: var(--fg-dim);
  width: 12px;
  flex: none;
}
.folder-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.folder-count {
  color: var(--fg-dim);
  font-size: 11px;
}
.folder-input {
  flex: 1;
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 4px;
  color: var(--fg);
  padding: 3px 6px;
  outline: none;
  font-size: 13px;
  user-select: text;
}
.panel-item.indent {
  margin-left: 16px;
}
.panel-item.drop-before {
  box-shadow: 0 -2px 0 0 var(--accent);
}
.panel-item.drop-after {
  box-shadow: 0 2px 0 0 var(--accent);
}
.panel-item.drop-into,
.panel-loose.drop-into {
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.panel-divider {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  margin: 6px 8px;
}
.panel-loose {
  min-height: 48px;
}
```

- [ ] **Step 4: Typecheck and full manual smoke**

Run: `npm run typecheck` — Expected: clean
Run: `npm test` — Expected: PASS

Smoke (`npm run dev`):
1. `Cmd+B` toggles the panel open/closed; pins+tabs replace it when closed.
2. `＋ Folder` → inline input → Enter creates; Esc cancels.
3. Double-click folder name → rename inline. Right-click → Rename does the same.
4. Right-click folder → Delete Folder… on a non-empty folder → confirm dialog; Cancel keeps it, Delete removes folder + contents (star on an affected open page un-fills).
5. Drag bookmark over bookmarks → indicator lines, order commits.
6. Drag bookmark onto folder row → row outline, lands inside, folder auto-expands.
7. Drag bookmark from folder onto a top-level bookmark → moves out at that position; drop on empty space below → moves to top level end.
8. Drag folders to reorder them.
9. Right-click bookmark → Move to submenu reflects current location; Delete removes.
10. Click a bookmark → opens anchored tab; click again from panel → refocuses same tab; navigate away → `Ctrl+Cmd+H` returns to bookmarked URL.
11. Quit and relaunch → the anchored tab still answers `Ctrl+Cmd+H`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/panel.ts src/renderer/main.ts src/renderer/style.css
git commit -m "feat: bookmarks panel with folders, inline rename, drag and drop"
```

---

### Task 8: Final verification sweep

**Files:** none (verification only; fix anything found)

- [ ] **Step 1: Full test suite** — Run: `npm test` — Expected: all suites PASS
- [ ] **Step 2: Typecheck** — Run: `npm run typecheck` — Expected: clean
- [ ] **Step 3: Production build** — Run: `npm run build` — Expected: succeeds
- [ ] **Step 4: End-to-end smoke against the spec** — walk the Task 7 smoke list once more on the built/dev app, plus: `Cmd+D` toggling while the panel is open updates it live; history panel (`Cmd+Y`) unchanged; tab/pin drag unchanged; v1 `bookmarks.json` from a pre-upgrade profile loads and migrates (copy an old file into userData or craft one).
- [ ] **Step 5: Commit any fixes** with conventional messages; if none, done.
