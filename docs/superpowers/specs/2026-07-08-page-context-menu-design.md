# Page Context Menu — Design

**Date:** 2026-07-08
**Status:** Approved

## Goal

Right-clicking inside a web page currently shows nothing. Add a native context
menu for links, images, text selections, and the page itself.

## Architecture

New module `src/main/page-context-menu.ts` with two parts:

1. **`buildPageContextMenu(params, ctx)` — pure, Electron-free.** Takes the
   relevant fields of Electron's `context-menu` event params plus a context
   object describing the tab (`canGoBack`, `canGoForward`), and returns a
   declarative item list (label / action id / enabled / separator). Fully
   Vitest-covered.
2. **`attachPageContextMenu(wc, actions)` — thin Electron wrapper.** Registers
   `wc.on('context-menu', …)`, calls the builder, maps action ids to real
   effects, and pops a `Menu.buildFromTemplate(...).popup({ window })`.

Wired from `index.ts` inside the existing `onTabCreated` callback (next to
`attachCycleHooks`), so every page view — default and Work profile, including
recreated views after a profile switch — gets the handler. The chrome UI
renderer is not involved; this menu never appears there.

## Menu structure

Sections appear in this order, separated by separators. A linked image shows
both the link and image sections.

### 1. Link section — when `params.linkURL` matches `^https?://`

- **Open Link** — `wc.loadURL(linkURL)` in the same tab
- **Open in a New Tab** — new tab in the background (`activate: false`),
  inheriting the source tab's profile (a Work-tab link opens a Work tab)
- ─ separator ─
- **Bookmark Link** — `bookmarks.add(linkURL, title, Date.now(), profile)`
  where title = trimmed `params.linkText`, falling back to the URL, and
  profile = the source tab's profile; then the existing `bookmarksChanged()`
  runs so the bookmark appears as an asleep sidebar slot
- **Copy Link URL** — `clipboard.writeText(linkURL)`

Non-http(s) links (`mailto:`, `javascript:`, …) get no link section.

### 2. Image section — when `params.mediaType === 'image'` and `params.srcURL` is non-empty

- **Copy Image** — `wc.copyImageAt(params.x, params.y)`
- **Copy Image URL** — `clipboard.writeText(srcURL)`
- **Download Image** — `wc.downloadURL(srcURL)`; flows through the existing
  `DownloadManager` via `will-download`, which is already attached to both the
  default and Work sessions

Labels are deliberately verbose ("Copy Image", not "Copy") to stay unambiguous
when link/selection items share the menu.

### 3. Edit/selection section

- In editable fields (`params.isEditable`): **Cut / Copy / Paste**, enabled per
  `params.editFlags` (`canCut` / `canCopy` / `canPaste`), using the
  `role`-equivalent webContents actions (`wc.cut()` / `wc.copy()` / `wc.paste()`)
- Otherwise, when `params.selectionText` is non-empty: **Copy** only

### 4. Page section — only when none of the above sections rendered

- **Back** — enabled per `navigationHistory.canGoBack()`
- **Forward** — enabled per `navigationHistory.canGoForward()`
- **Reload**

## Data flow

`wc context-menu event → buildPageContextMenu(params, ctx) → item list →
attach wrapper maps action ids → TabManager / BookmarksStore / clipboard /
downloadURL`. The attach wrapper receives its effects as an injected `actions`
object from `index.ts` (create background tab with profile, add bookmark +
notify), so `page-context-menu.ts` imports neither TabManager nor
BookmarksStore concretely and TabManager's options interface is untouched.

## Error handling / edge cases

- data:-URL pages (error page, crashed-page screen): link/image sections
  rarely apply; the page fallback section still works.
- Bookmark Link never creates a live tab — the bookmark arrives asleep, which
  `syncBookmarks` already handles.
- No ElectronChromeExtensions involvement: extension `chrome.contextMenus`
  entries are out of scope (future enhancement — the library exposes
  `getContextMenuItems` for this). Work tabs therefore need no special-casing.
- The menu is native (`Menu.popup`), so the WebContentsView z-order problem
  that affects the suggestions dropdown does not apply.

## Testing

- **Vitest** on `buildPageContextMenu`: link-only, image-only, linked image,
  selection, editable field, plain page, non-http(s) link, enabled flags for
  Back/Forward and Cut/Copy/Paste, section order and separators.
- **Manual smoke** (per README convention): clipboard contents, image copy,
  download landing in the downloads UI, background-tab profile inheritance,
  Bookmark Link appearing in the sidebar.

## Decisions log

- Background (unfocused) new tab — matches Chrome/Safari. (User-confirmed)
- Basics included beyond the original ask: selection Copy, editable
  Cut/Copy/Paste, page Back/Forward/Reload. (User-confirmed)
- Verbose image labels over the terse originals. (User-confirmed)
