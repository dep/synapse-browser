# Issue Batch — Design (issues #2, #4, #5, #8, #10, #11)

2026-07-08. Status: approved (autonomous run; design decisions made by agent per
user instruction to proceed on best judgment).

## Scope

Six GitHub issues, ordered by dependency:

1. Shortcuts registry (groundwork demanded by #5, consumed by #2/#8/#10)
2. #2 — Control+S toggles the sidebar
3. #8 — Cmd+=/Cmd+- zoom the page (plus Cmd+0 reset)
4. #10 — Alt+Cmd+Up/Down traverse prev/next tab in sidebar order
5. #4 — Cmd+, opens a placeholder Settings view
6. #5 — Settings → Keyboard Shortcuts: list all shortcuts, re-record them
7. #11 — Export bookmarks to JSON / import from that JSON

## 1. Shortcuts registry

Menu accelerators become data, not literals.

- `src/shared/shortcuts.ts` (Electron-free): `ShortcutCommand { id: string;
  label: string; default: string }` and `SHORTCUT_COMMANDS: ShortcutCommand[]`
  covering every rebindable menu command:
  `new-tab` (CmdOrCtrl+T), `close-tab` (CmdOrCtrl+W), `close-other-tabs`
  (CmdOrCtrl+Shift+W), `close-tabs-below` (Control+CmdOrCtrl+Down),
  `close-tabs-above` (Control+CmdOrCtrl+Up), `reload-page` (CmdOrCtrl+R),
  `back` (CmdOrCtrl+[), `forward` (CmdOrCtrl+]), `toggle-sidebar` (Control+S),
  `zoom-in` (CmdOrCtrl+=), `zoom-out` (CmdOrCtrl+-), `zoom-reset` (CmdOrCtrl+0),
  `next-tab` (Alt+CmdOrCtrl+Down), `prev-tab` (Alt+CmdOrCtrl+Up),
  `pin-tab` (CmdOrCtrl+P), `restore-anchor` (Control+CmdOrCtrl+H),
  `focus-urlbar` (CmdOrCtrl+L), `bookmark-page` (CmdOrCtrl+D),
  `history` (CmdOrCtrl+Y), `settings` (CmdOrCtrl+,).
  Also `resolveShortcuts(overrides: Record<string, string>): Record<string, string>`
  → id → accelerator (defaults merged with valid overrides; unknown ids ignored).
- `src/main/shortcuts-store.ts`: `JsonStore`-backed `shortcuts.json`
  `{ v: 1, overrides: {} }`. `resolved()`, `set(id, accel)`, `reset(id)`,
  `resetAll()`, `flush()`.
- `buildMenu` gains a `shortcuts: Record<string, string>` parameter and reads
  every accelerator from it. The Tab 1–9 items and the Ctrl+Tab / Option+Tab
  cycling chords are NOT in the registry: Tab 1–9 stay static menu accelerators;
  the cycling chords live in `before-input-event` (commit-on-modifier-release
  cannot be expressed as an accelerator) and are shown read-only in settings.
- Menu is rebuilt (existing `buildMenu` call pattern) whenever an override
  changes.

## 2. Sidebar toggle (#2, Control+S)

- `ui.json` gains `sidebarVisible: boolean` (default true) beside
  `sidebarWidth`; both clamped/validated on read.
- `TabManager.setSidebarVisible(visible: boolean)`: `layout()` uses effective
  width `visible ? sidebarWidth : 0`.
- Main pushes `ui:sidebar-visible` (boolean) to the renderer on toggle and on
  boot (alongside `ui:sidebar-width`). Renderer sets the grid column to 0 and
  hides `#sidebar` + `#sidebar-resize` when hidden (CSS class on `#app`).
- Menu item View → "Toggle Sidebar" (`toggle-sidebar` registry entry).

## 3. Page zoom (#8)

- `TabManager.zoomActive(delta: 1 | -1 | 0)`: on the active tab's webContents,
  `setZoomLevel(0)` when delta is 0, else `setZoomLevel(clamp(getZoomLevel() +
  delta, -7, 9))` (Chromium's practical range). No-op when no active view.
- Menu items View → Zoom In / Zoom Out / Actual Size (`zoom-in`, `zoom-out`,
  `zoom-reset`). Zoom is per-webContents, session-only — no persistence (matches
  issue scope).

## 4. Order traversal (#10)

- `TabManager.activateSibling(dir: 1 | -1)`: index of `activeId` in
  `model.order`, wrap around, `activateTab`. When the active id is a pin or
  bookmark slot (not in `order`), activate the first (dir 1) or last (dir -1)
  order tab. No-op when `order` is empty.
- Menu items Tabs → Next Tab / Previous Tab (`next-tab`, `prev-tab`).
- Distinct from Ctrl+Tab MRU cycling: immediate activation, no preview/commit.

## 5. Settings view (#4)

- Main keeps `settingsOpen: boolean` (not persisted). `TabManager.
  setSettingsOpen(open)`: while open, the active view is detached (page hidden —
  chrome renderer is visible wherever no view covers it); on close, reattached.
  Opening a tab (activate/create) closes settings.
- IPC: menu/`settings` command → toggles → pushes `ui:settings` (boolean) to
  renderer. Renderer shows `#settings` (grid row 2 / column 2 cell, hidden by
  default): heading "Settings", left nav with two entries — "General"
  (placeholder body: "No settings yet.") and "Keyboard Shortcuts" (#5's view).
- Menu item: app menu area is role-based; put "Settings…" under Tools with
  `CmdOrCtrl+,` (`settings` registry entry).

## 6. Keyboard shortcuts settings (#5)

- `src/shared/accelerator.ts` (Electron-free, Vitest-covered):
  `acceleratorFromKeyEvent(e: {key, code, metaKey, ctrlKey, altKey, shiftKey})`
  → Electron accelerator string or null when invalid. Rules: require at least
  one non-shift modifier (or an F1–F24 key); normalize
  (letters → uppercase, `ArrowUp` → `Up`, `+`/`=` → their accelerator names,
  digits, `Space`, `Escape` excluded — Esc cancels recording). Modifier order:
  Control, Alt, Shift, Cmd.
- IPC (`SynapseApi.shortcuts`):
  - `list(): Promise<ShortcutRow[]>` where `ShortcutRow { id, label,
    accelerator, default, fixed: boolean }`. Includes the rebindable registry
    plus read-only rows (fixed: true) for Ctrl+Tab / Ctrl+Shift+Tab MRU cycling,
    Option+Tab / Option+Shift+Tab order cycling, and Tab 1–9.
  - `set(id, accelerator): Promise<{ ok: true } | { ok: false; error: string }>`
    — rejects unknown/fixed ids, invalid accelerators, and conflicts with any
    other resolved binding (error names the conflicting command).
  - `reset(id)`, `resetAll()` — remove override(s).
  On any change main persists, rebuilds the menu, and the settings view
  re-fetches `list()`.
- Recorder UX: each row shows label + current binding (chip). Click chip →
  "Press shortcut…" recording state; next valid keydown becomes the binding
  (via `set`, inline error on conflict); Esc cancels. Per-row "Reset" button
  when overridden; "Reset All" in the header.

## 7. Bookmarks export / import (#11)

- Export file shape: `{ v: 1, folders: BookmarkFolder[], bookmarks: Bookmark[] }`
  — exactly `BookmarksStore.list()`, pretty-printed.
- `src/shared/bookmarks-io.ts` (Electron-free, Vitest-covered):
  - `parseBookmarksExport(text: string): BookmarksData | null` — JSON parse +
    shape validation (v === 1, arrays, per-item required fields; unknown fields
    dropped; invalid items skipped).
  - `planImport(existing: BookmarksData, incoming: BookmarksData):
    { folders: string[]; bookmarks: Array<{ url; title; profile; folderName:
    string | null }>; skipped: number }` — folders matched by name (case
    sensitive); bookmarks deduped against existing AND within the import by
    (url, target folder); returns what to create.
- Main (File menu): "Export Bookmarks…" → `dialog.showSaveDialog` (default name
  `synapse-bookmarks-<YYYY-MM-DD>.json`) → write. "Import Bookmarks…" →
  `dialog.showOpenDialog` → parse; on invalid file, error box. Apply plan via
  `bookmarks.addFolder` / `bookmarks.add` + `moveToFolder`, then
  `bookmarksChanged()`; summary box "Imported N bookmarks (M skipped as
  duplicates)". Favicons are not exported (session-local); imported bookmarks
  start with no favicon and pick one up when opened.

## Error handling & edge cases

- Corrupt `shortcuts.json` → `.bad` + defaults (JsonStore).
- Conflicting override stored on disk by hand: `resolveShortcuts` keeps it
  (last-writer wins at set-time; disk is trusted like ui.json), but `set()`
  prevents creating conflicts in-app.
- Sidebar hidden + drag handle: handle hidden too; resize only when visible.
- Settings open + Cmd+W etc.: tab commands still act on the model; closing the
  active tab while settings is open keeps settings visible (no view attaches
  while open).
- Import into Work-profile bookmarks: `profile` field round-trips.

## Testing

- Vitest: `resolveShortcuts` (merge, unknown ids), `acceleratorFromKeyEvent`
  (letters, arrows, punctuation, modifier requirements, ordering, Esc/naked-key
  rejection), `parseBookmarksExport` (valid, corrupt, wrong version, partial
  items), `planImport` (dedupe, folder matching, intra-import dupes, profile
  preservation), shortcuts-store round-trip.
- Electron-coupled (menu wiring, view detach, zoom, traversal): typecheck +
  scripted/manual smoke at end of run.
