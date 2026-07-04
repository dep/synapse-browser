# Synapse Browser — v1 Design

**Date:** 2026-07-04
**Status:** Approved pending user review

## Overview

Synapse Browser is a very simple Chromium-based macOS browser built on Electron. v1 ships:
vertical tabs, URL bar with history suggestions, back/forward/reload, keyboard shortcuts
(including MRU tab cycling), working downloads, history, and bookmarks.

## Architecture

Electron app with three code areas:

- `src/main/` — main process. Window creation, tab orchestration (`WebContentsView`
  lifecycle and bounds), downloads, history/bookmarks persistence, keyboard shortcut
  handling, IPC handlers.
- `src/renderer/` — the chrome UI. Vertical tab sidebar (left, ~240px) and top bar
  (back/forward/reload, URL bar with suggestions dropdown, star button, downloads pill).
  Vanilla TypeScript + Vite. No framework.
- `src/preload/` — single preload script exposing a typed `window.synapse` API to the
  chrome UI only. `contextIsolation: true`, `nodeIntegration: false`. Web page tabs get
  **no** preload and no exposed API.

Rationale: `WebContentsView` is Electron's current, non-deprecated embedding API and each
tab is a real Chromium `webContents` with process isolation. The `<webview>` tag is
explicitly discouraged by Electron and was rejected.

## Tab model

Main process owns a `TabManager`:

- `Map<tabId, WebContentsView>`
- `order: tabId[]` — sidebar appearance order (creation order; new tabs append)
- `mru: tabId[]` — most-recently-used order, front = current tab. Updated whenever a tab
  activation is *committed* (see MRU cycling below).
- `activeId: tabId`

**Commands (renderer → main):** `tabs:create`, `tabs:close`, `tabs:activate`,
`tabs:navigate`, `tabs:back`, `tabs:forward`, `tabs:reload`.

**State (main → renderer):** a full `tabs:updated` snapshot — per-tab `{id, title,
favicon, url, isLoading, canGoBack, canGoForward}` plus `order` and `activeId` — pushed
whenever any tab's `webContents` emits `page-title-updated`, `page-favicon-updated`,
`did-navigate`, `did-navigate-in-page`, `did-start-loading`, or `did-stop-loading`, or
when tab structure changes. The chrome UI is a pure function of the latest snapshot; it
holds no duplicate state.

**Bounds:** active view fills the window minus sidebar (left) and top bar; recomputed on
window `resize`. Inactive views are removed from the content view (not destroyed).

**Popups:** `setWindowOpenHandler` on every tab converts `window.open` / `target=_blank`
into a new tab (denies the popup, creates a tab with the URL).

**Closing the last tab** creates a fresh new-tab in its place (window always has ≥1 tab).

## URL bar

Input classification (pure function, unit tested):

1. Has a scheme (`https://`, `http://`, `file://`) → load as-is.
2. Looks like a host (`foo.com`, `localhost:3000`, IP) → prefix `https://`.
3. Otherwise → DuckDuckGo search: `https://duckduckgo.com/?q=<encoded>`.

While typing, the top 5 fuzzy matches from history render in a dropdown (arrow keys +
Enter to select, Esc to dismiss).

## Keyboard shortcuts

Standard shortcuts via `Menu` accelerators: Cmd+T (new tab), Cmd+W (close tab), Cmd+L
(focus URL bar), Cmd+R (reload), Cmd+[ / Cmd+] (back/forward), Cmd+D (bookmark current
page), Cmd+Y (toggle history panel).

**Tab cycling** — two orders, both with hold-and-walk semantics:

- **Ctrl+Tab / Ctrl+Shift+Tab — MRU order.** While Ctrl is held, each Tab press moves a
  cursor one step deeper into (or back out of) the `mru` list, activating each tab as a
  live preview. Releasing Ctrl **commits**: the previewed tab is promoted to the front of
  `mru`. A single quick Ctrl+Tab therefore toggles between the two most recent tabs.
- **Alt(Option)+Tab / Alt(Option)+Shift+Tab — appearance order.** Same hold-and-walk
  mechanics, but the cursor moves through `order` (the sidebar order), wrapping at the
  ends. Committing on release promotes the chosen tab in `mru` as a normal activation.

Implementation: menu accelerators cannot observe modifier key-up, so cycling is captured
in the main process via `before-input-event` on every tab's `webContents` **and** on the
chrome window's own `webContents` (intercepting Tab-with-modifier keydowns and
Ctrl/Option keyups) — one uniform hook, no renderer-side key forwarding. The MRU walk
state (cursor + pending commit) lives in the pure `TabModel` and is unit tested.

## Persistence

JSON files in `app.getPath('userData')`, written by main with a debounce (~500ms):

- `history.json` — `{v: 1, entries: [{url, title, visitedAt}]}`, most recent first,
  capped at 5,000 entries. Every committed navigation to an `http(s)` URL appends.
- `bookmarks.json` — `{v: 1, bookmarks: [{url, title, createdAt}]}`. Star button and
  Cmd+D toggle the current page.

Corrupt/unparseable files are renamed to `<name>.bad` and recreated empty — never crash.

## Downloads

`session.on('will-download')` → save to `~/Downloads` (auto-resolve name collisions via
Electron default behavior). Progress streams to a pill in the top bar; clicking a
completed item reveals it in Finder. No downloads manager page.

## Error handling

- `did-fail-load` (main frame, non-abort) → load an in-app error page (data: URL or
  bundled file) showing the error description and a Retry button.
- `render-process-gone` → same sad-tab treatment with Reload.
- IPC handlers validate inputs (unknown `tabId` is a no-op, not a throw).

## Testing

- **Vitest unit tests** for pure logic, extracted into Electron-free modules:
  URL classification, history fuzzy matching, and `TabManager` state transitions
  (order/mru/cycling/commit semantics against a mocked view factory).
- **Smoke:** `npm start`, browse, verify tabs/downloads/history/bookmarks manually.
  No e2e harness in v1 (YAGNI).

## Stack

- Electron (current stable), TypeScript, Vite for the chrome UI, Vitest.
- `electron-builder` deferred until distribution is actually wanted.
- History/bookmarks JSON persistence mirrors the Synapse Meetings approach.

## Out of scope for v1

Profiles, extensions, settings UI, sync, ad blocking, tab drag-reorder, tab groups,
pinned tabs, find-in-page, zoom UI (Cmd+/- may come free via menu roles), Windows/Linux.
