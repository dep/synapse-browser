# Pinned Tabs — Design

Date: 2026-07-04
Status: Approved (pending spec review)

## Concept

A pin is a persistent slot — `{ url, title, favicon }` — saved in its own store
(`pins.json`), independent of session tabs. Pins render as a compact icon grid at the
top of the sidebar. A pin may be **awake** (backed by a live `WebContentsView`) or
**asleep** (just the saved slot; loads lazily on first activation). At startup all pins
are asleep — fast launch, no surprise network traffic.

## State model

- `TabModel` stays pure (Electron-free) and gains a `pinned: string[]` list alongside
  `order`. Pin ids are stable (`pin-<n>`) and live in `pinned` order.
- Awake pins participate in MRU like any tab; asleep pins do not.
- The combined addressing sequence for Cmd+1–9 is `[...pinned, ...order]`:
  Cmd+1 = first pin, numbering continues into regular tabs, Cmd+9 = last entry of the
  combined sequence (the last regular tab, or the last pin if no regular tabs exist).
- Ctrl+Tab (MRU) and Option+Tab (sidebar order = pins then tabs) cycle over awake tabs
  only; sleeping pins are skipped.

## Behaviors

- **Pin (Cmd+P or sidebar context menu):** the active/clicked regular tab morphs in
  place — its live view is preserved, it moves from the regular tab list into the pin
  row (appended at the end), and its current URL is captured as the *pinned URL*.
- **Unpin (same toggles):** the pin morphs back into a regular tab at the **top** of
  the tab list (adjacent to the pin row, so it visually "falls out"). Unpinning a
  *sleeping* pin creates a regular tab loading its pinned URL.
- **Cmd+W on a pinned tab:** puts it to sleep (view destroyed, slot stays) and
  activates the next MRU tab; if no other awake tab exists, a fresh empty tab is
  created (matching today's close-last-tab behavior). A pin never disappears via
  close — only via unpin.
- **Ctrl+Cmd+H:** navigates the **active** pinned tab back to its pinned URL (no-op on
  regular tabs). Also available in a pin's context menu ("Restore Pinned URL").
- The pinned URL updates only by re-pinning (unpin → pin) — navigation never silently
  rewrites it.
- Pinning the same URL twice is allowed (pins are slots, not bookmarks); no dedupe.

## Persistence

- New `pins.json` (`v: 1`, array of `{ url, title, favicon }`) via the existing
  `JsonStore` (debounced writes, corrupt-file `.bad` recovery).
- Favicon URL/data-URL is saved so sleeping pins still show their icon.
- Session restore (`tabs.json`) is untouched — it keeps handling regular tabs only.
  Awake/asleep state is not persisted; all pins wake asleep after restart.

## UI

- Sidebar gets a pin grid above the tab list: square favicon buttons, active-pin
  highlight, sleeping pins slightly dimmed.
- **Layout:** max 4 pins per row; after 4, a new row appears. Pins flex to fill the
  row's horizontal space — with n ≤ 4 pins each takes 1/n of the width (2 pins are 50%
  each); with more than 4, the grid is 4 equal columns and pins wrap.
- Click a pin = activate (waking it if asleep).
- Right-click on any pin or sidebar tab shows a native context menu (built in main via
  `Menu.popup`): Pin/Unpin, Restore Pinned URL (pins only), Close.
- `TabsSnapshot` grows `pinned: string[]`; `TabInfo` grows `isPinned`, `pinnedUrl`, and
  `isAsleep` so sleeping pins appear in the snapshot and the renderer stays a pure
  function of it.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| Cmd+P | Pin/Unpin active tab (menu accelerator, Tabs menu) |
| Ctrl+Cmd+H | Restore active pin to its pinned URL (menu accelerator) |
| Cmd+1–9 | Combined sequence: pins first, then regular tabs; Cmd+9 = last tab |

## Testing

- `TabModel` pin/unpin/ordering/addressing/cycling logic: Vitest (stays Electron-free).
- `pins.json` store round-trip: Vitest.
- Wake/sleep view lifecycle, context menu, grid layout: manual smoke per repo
  convention (README checklist gains a Pins section).
