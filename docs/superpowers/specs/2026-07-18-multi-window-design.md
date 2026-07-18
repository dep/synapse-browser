# Multi-Window Support — Design

**Date:** 2026-07-18
**Issue:** [#26](https://github.com/dep/synapse-browser/issues/26) — Cmd+N to spawn a new window, and the ability to drag a tab out to its own new window.

## Goals & decisions (approved in brainstorming)

- **Two phases, one design.** Phase 1: multi-window foundation + Cmd+N (own PR). Phase 2: drag-tab-out-to-new-window (follow-up PR on the foundation).
- **Secondary windows are ephemeral.** Only the primary window persists to `tabs.json`. Secondary windows are throwaway workspaces: on quit their tabs simply close (recoverable via history). No windows-array persistence schema.
- **Secondary sidebar is minimal.** No pins, no bookmarks section, no AI sidebar — just the window's own tabs. Pins and bookmarks remain primary-window furniture.
- **Drag-out UX:** drop a tab outside the sidebar/window bounds → a new secondary window spawns at the drop point with that tab (same live WebContents — no reload). Dropping inside the sidebar still reorders as today.
- **Architecture:** window-bundle factory. One code path for all windows; no parallel "secondary window" implementation, no windowId threading through the pure tab model.

## Section 1 — Window lifecycle & roles

**`createWindow(role)` factory** (new `src/main/window.ts`): extracts everything currently trapped in the `app.whenReady()` closure in `src/main/index.ts` into a factory that builds a per-window bundle:

- the `BrowserWindow`
- its own `TabManager` (and therefore its own pure `TabModel`: order, MRU, cycling)
- its own `SuggestionsOverlay`
- sidebar-resize controllers (left + AI where applicable)
- per-window wiring: `before-input-event` cycle hooks, blur→cycle-commit, resize→layout

A module-level **registry** (`Map<winId, WindowBundle>`) plus a **`bundleFor(webContents)`** resolver replaces the captured `win`. The registry records every WebContents it knows about (chrome renderer, suggestions overlay view, each page view) so resolution is explicit, never guessed.

**Roles:**

- **Primary** — the first window, created at launch. Exactly today's behavior: restores `tabs.json` and pins, renders pins + bookmarks, writes persistence on every snapshot, hosts the AI sidebar.
- **Secondary** — created by Cmd+N (phase 1) or drag-out (phase 2). Ephemeral workspace; never writes to `tabs.json`/`pins.json`. The `tabs:updated` snapshot carries a `role` flag; the chrome renderer suppresses pins, bookmarks, and the AI toggle when `role === 'secondary'`.

**Lifecycle:**

- Cmd+N = "New Window" menu item (`CmdOrCtrl+N`), opens a secondary with one new-tab page.
- Closing a secondary disposes its bundle (views destroyed, registry entry removed, store writes: none).
- Closing the primary while secondaries live is allowed; its persisted state was already flushed by the debounced store. No promotion of a secondary to primary.
- `window-all-closed → app.quit()` stays as-is.
- **Tab id uniqueness:** the `tab-N` counter moves from per-`TabManager` to module-global so ids are unique across windows — prerequisite for phase 2's cross-window tab move.

## Section 2 — IPC routing & subsystem behavior

**Sender-aware IPC.** All `tabs:*`, `sugg:*`, `ui:*`, `find:*` handlers remain registered once (globally) but resolve their target bundle via `bundleFor(event.sender)` instead of a closed-over `win`. Global concerns (`settings:*`, `history:list`, `shortcuts:*`, `newtab:*`) stay global. `history:search` reads the *sender's* bundle's active tab. `bookmarks:*` also resolve the sender; since only the primary renders bookmark UI, behavior is unchanged.

**Per-subsystem:**

- **Extensions** — `ExtensionManager` becomes app-global. `addTab(wc, win)` receives the tab's actual window; the `createTab` callback (chrome.tabs.create) lands in the last-focused default-session window, falling back to primary. Secondary windows' default-profile tabs are fully extension-registered. Work-profile tabs stay excluded everywhere, as today.
- **Menu** — one global app menu; every command resolves `BrowserWindow.getFocusedWindow()` → bundle at invocation time. Adds "New Window" (`CmdOrCtrl+N`) above "New Tab".
- **Downloads** — session-level as today; the shelf list is app-global, so updates broadcast to every window's chrome (routing a global list to one window would show a wrong subset).
- **Permission prompts** — parent to the requesting tab's window instead of the fixed `win`.
- **AI sidebar** — primary-only. Single `AiChatController` stays bound to the primary bundle; the AI toggle is suppressed in secondary chrome.
- **Find-in-page / tab cycling / suggestions** — state already lives on `TabManager` (or per-window overlay), so they become per-window once the bundle owns them. Menu Find and blur-commit route per window.
- **`open-url` / `second-instance`** — route into the focused window, falling back to primary.
- **`shortcuts:recording`** — gates menu shortcuts (`setIgnoreMenuShortcuts`) on all windows while recording.

**Renderer changes are minimal:** the chrome UI stays a pure function of its own window's `tabs:updated` snapshot; the only addition is the `role` flag hiding pins/bookmarks/AI in secondaries.

## Section 3 — Drag-out (phase 2)

- **Renderer detection:** the existing HTML5 drag in `src/renderer/drag-list.ts` gains a `dragend` path — if the drop landed on no internal drop zone and the pointer's screen position is outside the window's bounds, the sidebar calls a new `tabs:detach` IPC with the tab id and screen coordinates. Drops inside the sidebar reorder exactly as today; drops on the bookmarks panel still bookmark.
- **Main-side move:** `TabManager.detachTab(id)` removes the tab from the source model/window *without destroying the `WebContentsView`*, returning the live view + metadata (url, title, favicon, profile). A new secondary window spawns at the drop point and **adopts** the view: same WebContents, so no reload and audio keeps playing. Extension registration moves to the new window (`removeTab` + `addTab` with the new win). Work-profile tabs keep their session (the view is reused, so the session cannot change).
- **Edge cases:**
  - Detaching the last tab of a secondary auto-closes the emptied window.
  - The primary keeps its existing last-tab-closed behavior.
  - Pinned tabs and bookmarks are not draggable out.
  - Only `kind:'tab'` drags participate; pin drags keep their current reorder-only behavior.

## Testing

- **Pure model logic under Vitest:** detach/adopt operations, cross-window id uniqueness, order/MRU/cycle integrity after removal, role-flag snapshot shape.
- **Electron-coupled wiring** (window spawn, view re-parenting, IPC routing, menu focus resolution) is verified by runtime smoke via the dev harness, per repo convention (`.agents/REPO_RULES.md`).

## Out of scope

- Persisting secondary windows across restarts (upgrade path exists: a windows array in `tabs.json` v2, if ephemeral ever stings).
- Chrome-style live tear-off preview during drag (not realistically achievable in Electron).
- Dragging tabs *between* existing windows (drop into another window's sidebar). The globally-unique tab ids and detach/adopt plumbing deliberately leave the door open.
- Per-window pins/bookmarks.
