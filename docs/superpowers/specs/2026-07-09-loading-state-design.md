# Page-Loading State — Design

**Date:** 2026-07-09
**Goal:** A pretty, modern, subtle loading state while pages load: a faux-progress
hairline under the topbar, a micro-spinner in sidebar/bookmark rows, and a
reload↔stop toggle. Ships as 0.4.3.

## Constraints that shape the design

- `WebContentsView`s always draw above the chrome renderer, so the indicator must
  live in chrome territory. The hairline sits at the bottom edge of the 52px topbar
  — chrome-owned pixels, no overlay games.
- Electron exposes no load-progress percentage, so the bar animates a faux curve
  (nprogress-style), not real progress.
- The chrome renderer is a pure function of `tabs:updated` snapshots; `isLoading`
  per tab is already in every snapshot. No new main→renderer events are needed.

## Components

### 1. `src/shared/load-progress.ts` (pure, Vitest-covered)

- `progressAt(elapsedMs): number` — `0.25 + 0.60 · (1 − e^(−elapsed/2500))`:
  starts at 25%, decelerates asymptotically toward an 85% ceiling, monotonic.
- Constants: `SHOW_DELAY_MS = 150` (anti-flicker), `FINISH_FADE_MS = 250`.

### 2. `src/renderer/loading-bar.ts`

`initLoadingBar(): { update(snap: TabsSnapshot): void }`, wired into `main.ts`'s
render path. Internals:

- Tracks `tabId → startedAt` (performance.now) for every tab whose `isLoading`
  flips true; entry removed when loading stops. Timestamps are per tab so
  switching to a tab that has been loading for 3s shows the bar at its 3s
  position — no restart-from-zero.
- Bar reflects the **active tab only**:
  - active tab loading → rAF loop paints `transform: scaleX(progressAt(elapsed))`;
    the element stays `opacity: 0` until `elapsed > SHOW_DELAY_MS`, so cache hits
    never flash.
  - active tab finishes while bar is showing → snap to `scaleX(1)`, fade out over
    `FINISH_FADE_MS`, reset.
  - user switches to a non-loading tab mid-run → reset instantly, no fake
    100% snap (the old tab is still loading in the background).
- The rAF loop runs only while a bar is in flight; idle costs nothing.

### 3. Visuals (`style.css` + one `<div id="loading-bar">` in the topbar)

- 2px hairline, full window width, pinned to the topbar's bottom edge
  (`#topbar` gains `position: relative`).
- `linear-gradient(90deg, var(--accent), #a8c3ff)` with a soft accent glow
  (box-shadow); `pointer-events: none`.
- `prefers-reduced-motion: reduce`: glow dropped, fades instant; the fill itself
  remains (it conveys state).

### 4. Sidebar / bookmarks spinner

- The `… ` title prefix (sidebar.ts, bookmarks-section.ts) is replaced by a 12px
  rotating ring (conic-gradient mask, `--accent`) rendered **in the favicon
  slot** while `isLoading`; titles stay clean.
- Rows are rebuilt (`innerHTML = ''`) on every snapshot, which would restart a
  CSS rotation each render. Spinners are phase-seeded with a negative
  `animation-delay` derived from `performance.now() % period` so all spinners
  share a stable global phase across re-renders.

### 5. Reload ↔ Stop

- While the active tab loads, `#nav-reload` shows `✕` / `title="Stop"`; click
  calls the new `tabs.stop(id)`.
- New IPC: `SynapseApi.tabs.stop(id)` → `tabs:stop` → `TabManager.stop(id)`
  (`webContents.stop()`). Same validation shape as the other tab channels.

## Testing

- Curve: unit tests (floor, ceiling, monotonicity, asymptote).
- Everything else is Electron/DOM-coupled → dev-instance CDP smoke: slow page
  shows bar and spinner, instant load doesn't flash, stop button cancels a load,
  bar follows the active tab across switches.

## Out of scope

- Real progress (Electron doesn't expose it), per-site theming of the bar,
  work-profile amber tint (declined), loading states for asleep pins.
