# Bookmark Folders, Reorder & Anchored Bookmark Tabs — Design Spec

**Date:** 2026-07-07
**Status:** Approved by user (brainstorming session)

## Goal

Four user-facing upgrades to bookmarks:

1. Drag-to-reorder bookmarks.
2. CRUD for bookmark folders (single level, no nesting) and drag bookmarks into/out of them.
3. `Cmd+B` toggles the sidebar between normal view and the Bookmarks panel.
4. A tab opened from a bookmark behaves like a pinned tab: `Ctrl+Cmd+H` restores it
   to the bookmarked URL after the user browses away, and clicking the bookmark again
   refocuses the existing tab instead of opening a duplicate.

## Decisions made during brainstorming

- **Folder depth:** single level. Folders contain bookmarks only.
- **Open behavior:** clicking a bookmark refocuses an existing matching tab (pin-style);
  only creates a new tab when none matches.
- **Folder delete:** deletes the folder's bookmarks too. A native confirm dialog guards
  non-empty folder deletion (no undo exists).
- **Panel layout:** folders section first, loose bookmarks below. Each section reorders
  within itself; no interleaving of folders and loose bookmarks.

## Section 1: Data model & store

`bookmarks.json` schema bumps to `v: 2`:

```ts
interface BookmarkFolder { id: string; name: string }
interface Bookmark {
  id: string          // new: stable id (URLs can repeat across folders)
  url: string
  title: string
  createdAt: number
  folderId?: string   // absent = top level
}
interface BookmarksFile { v: 2; folders: BookmarkFolder[]; bookmarks: Bookmark[] }
```

- **Order is array order.** `folders[]` order is folder display order; a container's
  bookmark order is the relative order of its members within `bookmarks[]`.
- **Migration:** loading a `v: 1` file stamps each bookmark with `crypto.randomUUID()`
  and adds `folders: []`. Corrupt files already become `<name>.bad` via `JsonStore` —
  unchanged.
- `BookmarksStore` API:
  - `addFolder(name): BookmarkFolder`
  - `renameFolder(id, name)`
  - `removeFolder(id)` — also removes member bookmarks
  - `reorder(id, toIndex)` — reorders a bookmark within its container, or a folder
    within the folder list (id disambiguates); `toIndex` is container-relative
  - `moveToFolder(bookmarkId, folderId | null, toIndex?)` — null = top level;
    `toIndex` (container-relative) places it for position-preserving drops, omitted
    = append to the container's end
  - `remove(bookmarkId)`
  - `toggle(url, title, createdAt)` — unchanged by-URL semantics; new bookmarks land
    at the top of the top level. `Cmd+D` keeps working as today.
  - `isBookmarked(url)` — unchanged.
- Reorder/move logic is pure array surgery inside the store (already Electron-free)
  with Vitest coverage.

## Section 2: Bookmarks panel UI + drag & drop

Layout (folders first, then loose bookmarks):

```
Bookmarks                    [+ folder]
▸ Work stuff            (5)
▾ Reading list          (3)
    ◦ Some article
    ◦ Another one
    ◦ Third thing
──────────────────────────────
◦ Loose bookmark
◦ Another loose bookmark
```

- **Folder rows:** disclosure triangle + name + bookmark count. Click toggles
  expand/collapse. Collapsed state is renderer-local (`Set<string>` in `panel.ts`),
  resets on restart — deliberately not persisted.
- **Expanded contents** render indented under the folder row.
- **`[+ folder]` button** in the panel heading creates a folder via an inline,
  autofocused text input (Enter commits, Esc cancels, empty name cancels).
- **Rename:** double-click the folder name → same inline input. Also in the
  right-click menu.
- **Context menus** run in main via a new `bookmarks:context-menu` IPC (same pattern
  as `tabs:context-menu`):
  - Folder: *Rename*, *Delete Folder…* — `dialog.showMessageBox` confirm when the
    folder is non-empty (delete destroys contents).
  - Bookmark: *Move to ▸* (submenu: Top Level + each folder, radio-style), *Delete*.
- Bookmark rows keep the current title+URL text look. No favicons (YAGNI).

**Drag & drop.** Extract the sidebar's `wireDrag`/indicator logic into
`src/renderer/drag-list.ts`, parameterized by a drag `kind` and an
`onDrop(draggedId, target)` callback. `sidebar.ts` keeps its exact behavior via the
helper; `panel.ts` reuses it. Rules:

- Bookmark dragged over a bookmark → before/after indicator → reorder within that
  container. Dropping onto a bookmark in a *different* container moves it there at
  that position (drag-into-folder and drag-out fall out of the same rule).
- Bookmark dropped onto a folder row → row highlights → appends into that folder and
  auto-expands it.
- Folder dragged over a folder → reorders folders. Folders never drop into folders.
- Bookmark dropped on the loose-bookmarks area / empty space below → moves to top
  level (end).
- Kind mismatches are ignored (same guard as the existing tab/pin drag code).

**Re-render model:** after any bookmark mutation, main pushes `ui:bookmarks-changed`
to the chrome renderer; the panel re-renders if visible. This is required because
context-menu actions (rename/delete/move) mutate in main after the popup returns, so
an invoke-resolve re-render can't see them — and it fixes `Cmd+D` while the panel is
open for free. Mutations are therefore fire-and-forget `send` channels; only `list`
is an `invoke`. The context menu's *Rename* pushes `ui:edit-folder` so the panel
opens its inline editor.

## Section 3: Anchored bookmark tabs (Ctrl+Cmd+H parity with pins)

A tab may carry an **anchor URL**. Pins already do (their `slot.url`); bookmark-opened
tabs get one too.

- `TabManager` gains `anchors: Map<tabId, url>`, set when a tab is created via
  bookmark-open. The anchor lives until the tab closes; navigation keeps it.
- **`bookmarks:open` flow:** main searches for a target in this order — an
  awake/asleep pinned tab whose slot URL matches the bookmark URL, else a tab whose
  anchor matches — and `activateTab`s it. No match → `createTab(url)` + set anchor.
- **`restorePinnedUrl` generalizes to `restoreAnchor(id)`:** pinned → load
  `slot.url`; anchored → load `anchors.get(id)`; neither → no-op. The `Ctrl+Cmd+H`
  menu item points at it, relabeled **"Restore Pinned/Bookmarked URL"**.
- **Context-menu parity:** anchored non-pinned tabs get the *Restore Bookmarked URL*
  item pins already have.
- **Snapshot:** `TabInfo.pinnedUrl` renames to `anchorUrl` (it already carries the
  pin slot URL; anchored tabs now populate it too). Only main-process consumer is
  `pinsStore.save`, updated accordingly.
- **Persistence:** `tabs-store` schema gains an optional `anchor` per tab (defaulted
  migration), so bookmark-opened tabs still answer `Ctrl+Cmd+H` after restart —
  parity with pins, which already persist their anchor.
- Deleting a bookmark does not clear anchors on open tabs; the stale anchor is
  harmless and only observable via `Ctrl+Cmd+H`.

## Section 4: Cmd+B, IPC surface

**Cmd+B:** the Tools → Bookmarks menu item changes accelerator from `Cmd+Shift+B` to
`Cmd+B`, still sending `ui:toggle-bookmarks`. The renderer's `setPanel('bookmarks')`
toggle already swaps the sidebar between normal view (pins + tab list) and the panel.
`Cmd+B` is unbound today (Electron's `editMenu` role has no Bold on macOS). History
stays on `Cmd+Y`.

**New IPC channels** (fire-and-forget `ipcMain.on`, args validated in main like
existing handlers; `bookmarks:list` stays an `ipcMain.handle`):

| Channel | Args |
|---|---|
| `bookmarks:open` | `bookmarkId` |
| `bookmarks:remove` | `bookmarkId` |
| `bookmarks:reorder` | `id, toIndex` (bookmark or folder) |
| `bookmarks:move-to-folder` | `bookmarkId, folderId \| null, toIndex?` |
| `bookmarks:add-folder` | `name` |
| `bookmarks:rename-folder` | `folderId, name` |
| `bookmarks:remove-folder` | `folderId` (confirm dialog lives in main) |
| `bookmarks:context-menu` | `target` (folder or bookmark id) |

`bookmarks:list` now returns `{ folders, bookmarks }`. `SynapseApi.bookmarks` in
`src/shared/ipc.ts` grows matching typed methods.

## Testing

Repo convention: pure logic → Vitest; Electron-coupled → manual smoke.

- **Vitest, `BookmarksStore`:** v1→v2 migration; reorder within a container; move
  across containers (position-preserving drop and append); folder delete removes
  members; folder reorder; `toggle` still dedupes by URL.
- **Vitest:** anchor-target matching order (pin slot beats anchor) if extracted as a
  pure helper; otherwise smoke-covered.
- **Manual smoke:** drag reorder / into / out of folders; folder CRUD incl. confirm
  dialog; `Cmd+B` toggle; bookmark-open refocus vs. new tab; `Ctrl+Cmd+H` restore on
  a bookmark tab, including after app restart. `npm run typecheck` and `npm test`
  green before done.

## Addendum (2026-07-07, post-smoke user feedback)

- **Bookmark rename:** bookmarks are renameable like folders — right-click →
  *Rename* (via a `ui:edit-bookmark` push) or double-click the row, both opening
  the shared inline editor. Store gains `renameBookmark(id, title)`; IPC gains
  `bookmarks:rename`. Single-click open is debounced 250ms so a double-click
  renames without navigating.
- **One shared bookmark tab:** `openBookmark` no longer creates a tab per
  bookmark. Pinned slots still win and an exact anchor match still refocuses,
  but otherwise the existing anchored (non-pinned) tab is reused — navigated to
  the new bookmark and re-anchored. Browsing around bookmarks therefore adds at
  most one tab to the sidebar.

## Out of scope

- Nested folders.
- Favicons in the bookmarks panel.
- Persisting folder collapsed state.
- Undo for deletions.
- Bookmark sync/import/export.
