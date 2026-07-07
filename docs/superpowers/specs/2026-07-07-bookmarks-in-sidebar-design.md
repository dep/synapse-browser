# Bookmarks in the Sidebar (Arc-style) — Design

Date: 2026-07-07
Status: Approved

## Goal

Replace the toggled bookmarks panel with a permanent bookmark section in the
sidebar, rendered between the pin grid and the normal tab list. A bookmark IS a
tab: clicking one loads it in place and the row highlights as the active tab;
closing it puts it to sleep (row stays). Each bookmark can be assigned a
profile (Default / Work) via its context menu, and opens in that profile's
session partition. The separate bookmarks view, the ⌘B shortcut, and the ★
footer button are removed.

## Decisions (confirmed with user)

- **Click model:** Arc-style — the bookmark row is the tab. No extra row
  appears in the normal tab list. Mirrors existing pin slot semantics.
- **Folders:** kept, as collapsible sections inside the bookmark section.
- **Profile labels:** stay "Default" / "Work" (no rename to Personal).
- **⌘D / ☆:** converts the active tab into a bookmark (like pinning);
  ⌘D on an active bookmark tab un-converts it back to a normal tab.
- **⌘1–9:** indexes pins → bookmarks → normal tabs in visual order; a
  sleeping bookmark's number wakes it.
- **Architecture:** generalize the pin slot machinery (Approach A). The
  shared-anchored-tab machinery is deleted, not adapted.

## 1. Data model

`Bookmark` (`src/shared/ipc.ts`) gains two optional fields; `bookmarks.json`
stays `v: 2`, no migration:

- `profile?: ProfileId` — absent = default (same pattern as `PinSlot.profile`).
- `favicon?: string | null` — captured while the bookmark's tab is awake so
  sleeping rows still show an icon.

`BookmarksStore` (`src/main/bookmarks.ts`):

- New `setProfile(id, profile)` and `setFavicon(id, favicon)`.
- `toggle(url, ...)` and `isBookmarked(url)` are removed. Bookmarking is now
  tab-identity based, not URL based: `add(url, title, createdAt, profile)`
  returns the new `Bookmark`; `remove(id)` unchanged. "Is this page
  bookmarked" becomes "is the active tab a bookmark tab".
- `TabInfo.isBookmarked` is removed; the star state derives from the active
  tab's bookmark identity. `TabInfo` gains `bookmarkId: string | null`.

## 2. TabModel (`src/main/tab-model.ts`)

A second slot list, `bookmarks: string[]`, sharing pin slot semantics:

- `wake` / `sleep` / `isAwake` / `activate` generalize from "is pinned" to
  "is a slot" (pinned or bookmark).
- `bookmark(id)` / `unbookmark(id)` mirror `pin` / `unpin`: a live tab
  converts in place keeping its id and MRU standing; un-bookmarking drops it
  to the top of the normal tab list.
- `addBookmark(id)` mirrors `addPin` (asleep restore at startup).
- `setBookmarkOrder(ids)` lets the manager sync the model's bookmark list to
  the store's visual order (folder members in folder order, then top-level),
  so cycling and ⌘1–9 match what the sidebar shows.
- **Option+Tab (order cycling):** pins-awake → bookmarks-awake → normal tabs.
- **Ctrl+Tab (MRU):** unchanged; awake bookmark tabs are in the MRU naturally.
- **⌘1–9 / `at(index)`:** `[...pinned, ...bookmarks, ...order]`.

## 3. TabManager (`src/main/tab-manager.ts`)

- Keeps a `tabId ↔ bookmarkId` map. Open bookmark: awake → activate; asleep →
  create the view in the bookmark's profile partition, load the stored URL,
  wake. Close (×, ⌘W) on a bookmark tab sleeps it: view destroyed, row stays —
  exactly like pins. The "no active tab left → create a fresh tab" fallback
  already covers sleeping the last awake tab.
- **Delete the shared-anchored-tab machinery:** the `anchors` map,
  `isAnchored`, `openBookmark`'s reuse logic, `TabInfo.anchorUrl` for
  non-pins, and the `anchor` field written by `tabs-store` (old files with the
  field still load). The bookmark's stored URL is the anchor; "Restore
  Bookmarked URL" reloads from the store.
- Snapshot: awake bookmark tabs report `bookmarkId`, loading state, and live
  favicon. Row titles always come from the store — a page retitling itself
  never renames a user-named bookmark. Live favicons are persisted back to the
  store via `setFavicon`.
- Profile change on an awake bookmark recreates its view in the new partition
  immediately (navigation history resets — inherent to session switching, same
  as tabs today). Work bookmark views are never registered with
  ElectronChromeExtensions, per the existing repo rule.

## 4. Sidebar UI (renderer)

Layout: pin grid → bookmark section → normal tab list, all always visible.

- Folder/bookmark rendering moves from `panel.ts` into a new
  `bookmarks-section.ts`; `panel.ts` keeps only history. All existing
  interactions carry over: collapsible folders with counts, double-click
  rename with the delayed single-click open, inline editors, drag to reorder
  and into/out of folders. "＋ Folder" moves to a small section header row.
- Bookmark rows get the tab-row treatment: favicon + title, active highlight
  when their tab is active, loading indicator, work-profile dot, and a hover ×
  that sleeps an awake bookmark (sleeping rows show no ×).
- A subtle divider separates bookmarks from normal tabs.
- Drag-a-tab-to-convert is out of scope for this pass; ⌘D covers conversion.

## 5. Menus, shortcuts, removals

- **⌘D / topbar ☆:** conversion toggle. Normal active tab → becomes a
  bookmark, inheriting the tab's current profile. Active bookmark tab →
  un-converts to a normal tab (bookmark removed, page stays open). Star
  renders filled when the active tab is a bookmark tab.
- **Bookmark context menu:** Rename / Move to / Delete as today, plus
  `Profile ▸ Default / Work` radio submenu, "Restore Bookmarked URL" (awake
  and navigated away), and "Put to Sleep" (awake).
- **Delete vs. un-bookmark:** context-menu Delete destroys the row and any
  awake view; ⌘D un-bookmark keeps the page open as a normal tab. Folder
  delete keeps the existing confirm dialog and destroys members' awake views.
- **Removed:** the bookmarks panel mode, the ⌘B menu item,
  `ui:toggle-bookmarks`, the ★ footer button, and the anchored-tab
  "Restore Bookmarked URL" branch of the tab context menu. History (⌘Y)
  is untouched.

## 6. Persistence

- Startup restores all bookmarks asleep (consistent with pins). Awake state
  is not persisted.
- `tabs.json` stops writing `anchor`; old files load fine (field ignored).
- `bookmarks.json` shape unchanged apart from the optional `profile` /
  `favicon` fields.

## 7. Testing

- **Vitest (pure modules):** new `TabModel` transitions — bookmark/unbookmark,
  wake/sleep, order cycling across the three groups, `at()` indexing,
  `setBookmarkOrder`; `BookmarksStore` — add/remove, setProfile, setFavicon,
  order sync source.
- **Manual smoke (Electron-coupled):** convert a tab with ⌘D and back;
  click-to-wake and ×-to-sleep; assign Work profile and verify isolated
  cookies; work dot and active highlight render; folder collapse/rename/drag
  still work; restart restores bookmarks asleep; ⌘B and the ★ button are gone;
  ⌘1–9 and Option+Tab walk pins → bookmarks → tabs.
