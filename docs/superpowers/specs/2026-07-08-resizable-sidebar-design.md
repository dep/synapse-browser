# Resizable Sidebar — Design

2026-07-08. Status: approved.

## Goal

Let the user drag the sidebar (tab bar) to any width between 180 and 480px, with the
page view tracking live and the width persisted across restarts. Default remains 240px.

## UX

- A 5px-wide hit strip along the sidebar's right edge; `col-resize` cursor and a 1px
  accent highlight on hover and while dragging.
- Drag clamps to [180, 480]. No double-click reset, no collapse mode.
- The page `WebContentsView` follows the drag in real time.

## Why the drag is driven by main, not the renderer

`WebContentsView`s draw and receive mouse events above the window's own renderer
(same constraint that forces the suggestions-dropdown overlay-height IPC). Once the
cursor crosses into the page area mid-drag, the chrome renderer stops receiving
mousemove/mouseup, so a renderer-tracked drag stalls or gets stuck. Main therefore
owns drag tracking via cursor polling; the renderer only initiates and renders.

## Data flow

1. **Initiate** — renderer `mousedown` on the handle sends `ui:sidebar-drag-start`.
2. **Track** — main starts a ~16ms interval: reads `screen.getCursorScreenPoint()`,
   converts to window-content-relative x, computes
   `width = clampSidebarWidth(x)`, updates `TabManager.sidebarWidth`, calls
   `layout()` (zero-hop view update), and pushes `ui:sidebar-width` (number) to the
   chrome renderer, which sets `#app { grid-template-columns: <px>px 1fr }`.
3. **End** — first of:
   - renderer `mouseup` → `ui:sidebar-drag-end` (cursor over chrome);
   - active page view `webContents` `input-event` with a left-button-up, or a
     mouse-move without `leftButtonDown` in its modifiers (cursor over page);
   - chrome UI `webContents` `input-event` equivalent (redundant with mouseup);
   - window `blur`.
   On end: stop the interval, detach the `input-event` listeners attached at drag
   start, persist the final width.
4. **Boot** — main pushes `ui:sidebar-width` with the stored value after the chrome
   UI finishes loading. The CSS 240px is only the pre-IPC initial value.

## Components

- `src/shared/sidebar-width.ts` — Electron-free:
  `SIDEBAR_WIDTH_DEFAULT = 240`, `SIDEBAR_WIDTH_MIN = 180`, `SIDEBAR_WIDTH_MAX = 480`,
  `clampSidebarWidth(px: number): number` (rounds; non-finite input → default).
- `src/shared/ipc.ts` — `SynapseApi.ui` gains `startSidebarDrag(): void`,
  `endSidebarDrag(): void`, `onSidebarWidth(cb: (px: number) => void): void`.
- `src/preload/index.ts` — wire the three channels
  (`ui:sidebar-drag-start`, `ui:sidebar-drag-end`, `ui:sidebar-width`).
- `src/main/ui-store.ts` — `JsonStore`-backed `ui.json` in `userData`:
  `{ v: 1, sidebarWidth: 240 }`. Written once per drag end (store debounces anyway).
- `src/main/tab-manager.ts` — `SIDEBAR_WIDTH` const → `sidebarWidth` field
  (initialized from the store by the caller); `setSidebarWidth(px)` clamps via the
  shared helper and calls `layout()`.
- `src/main/index.ts` — drag-session controller: handles the two IPC messages, owns
  the polling interval and end-of-drag listeners, pushes width to the renderer,
  persists on end.
- `src/renderer/` — handle element rendered by the chrome UI (`index.html` +
  `main.ts` wiring + `style.css`); applies `ui:sidebar-width` pushes to the grid.

## Edge cases

- Width is clamped in main (authoritative, shared helper); the renderer never
  computes a width, only renders pushes.
- Release outside the window: no mouseup reaches any surface; drag ends on window
  blur, or on the next `input-event` move showing the button is no longer held.
- Sleeping tab / no attached view during drag: chrome-side `input-event` + blur
  still end the drag; `layout()` no-ops safely when nothing is attached.
- Overlay height (suggestions dropdown) is an independent axis; `layout()` composes
  both. The dropdown lives in the topbar spanning both grid columns — unaffected.
- Corrupt `ui.json` → renamed `.bad`, defaults restored (existing `JsonStore`
  behavior).
- Window narrower than the sidebar: `layout()` already floors page width at 0.

## Testing

- Vitest: `clampSidebarWidth` — min/max clamping, rounding, NaN/Infinity → default.
- Manual smoke: slow and fast drags across the page boundary (no stall/stick);
  release over page, over chrome, and outside the window; restart restores width;
  suggestions dropdown alignment; Work-profile tab active during drag.
