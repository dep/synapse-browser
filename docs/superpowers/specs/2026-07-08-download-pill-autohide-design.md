# Download Pill Auto-Hide — Design

**Date:** 2026-07-08
**Status:** Approved

## Goal

The top-bar download pill (`#download-pill`) currently stays visible forever
after a download finishes. It should disappear 5 seconds after the latest
download reaches a terminal state.

## Behavior

- When the latest download's state is `completed` or `failed`, a 5-second
  timer starts; when it fires, the pill hides.
- Any downloads update (a new download starting, progress ticks) clears the
  pending timer and shows the pill again — a new download always re-reveals
  the chip.
- A `progressing` download never auto-hides.
- Click-to-reveal (Show in Finder) keeps working during the 5-second window.

## Implementation

`src/renderer/topbar.ts` only, inside `renderPill()` / the `onUpdated`
handler: one module-scoped timer id, `clearTimeout` on every update,
`setTimeout(hide, 5000)` when the rendered state is terminal. The 5000ms
value is a named constant. No IPC, main-process, or CSS changes.

## Testing

Manual smoke (renderer has no unit-test surface, per repo convention):
download a file → ✓ chip shows, disappears after ~5s; start a second
download while the first chip is fading → chip re-appears and tracks the
new download; failed download (✕) also disappears after ~5s.
