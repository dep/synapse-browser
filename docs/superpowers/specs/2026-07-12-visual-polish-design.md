# Visual Polish: Carved Canvas

2026-07-12 · brainstormed with visual companion; user selected Carved Canvas
shell, tinted active tabs, chrome-aware profile accents.

## Goal

Make the whole visible app feel refined and polished — "quiet luxury" — while
keeping the current minimal dark character. No new features; no light mode.
Scope is every visible surface: topbar + urlbar, sidebar (pins / bookmarks /
tabs), suggestions dropdown, find bar, downloads shelf, dialogs, settings page,
AI sidebar.

Today's CSS has six border radii (4/5/6/8/10/12px), one transition in the
entire app, no elevation system, and a topbar/sidebar seam. The design replaces
ad-hoc values with a small strict token system and one signature move.

## The shell and the canvas

The window chrome (topbar + sidebar) becomes one continuous surface — the
`--shell` tone, slightly lighter than today's `--bg` — with no seam between
topbar and sidebar. The web page becomes a rounded "canvas" carved into that
shell:

- The page `WebContentsView` is inset ~8px from the sidebar edge, right edge,
  and bottom edge (flush under the topbar's row is fine; final gap values
  tuned visually at implementation). `view.setBorderRadius(8)` rounds it —
  confirmed present in Electron 43 (`electron.d.ts`, View.setBorderRadius).
- The chrome renderer paints the surround: a 1px ring plus a soft drop shadow
  around the canvas cutout. The ring is profile-tinted (see below).
- Existing mechanics are preserved, offset-aware: `ui:set-overlay-height`
  page-shift for the suggestions dropdown, the loading hairline, find bar, and
  sidebar drag-resize.

This is the only main-process change (`tab-manager.ts` `layout()` +
`setBorderRadius` at view creation). All state logic (tab-model, stores) is
untouched.

## Tokens

CSS custom properties in `:root` (renderer `style.css`):

| Token | Value | Use |
| --- | --- | --- |
| `--shell` | `#26272d` | topbar + sidebar + window field |
| `--shell-raised` | `#31323a` | hover fills, pins at rest |
| `--well` | `#1c1d22` | urlbar idle, inputs, inset areas |
| `--line` | `rgba(255,255,255,.07)` | hairline borders |
| `--fg` / `--fg-dim` | unchanged | text |
| `--accent` / `--work` | unchanged (`#7aa2f7` / `#e0af68`) | profile colors |
| `--accent-wash` | `rgba(122,162,247,.14)` | active row fill, default profile |
| `--work-wash` | `rgba(224,175,104,.15)` | active row fill, work profile |
| `--r-s` | `6px` | rows, buttons, pins |
| `--r-m` | `8px` | urlbar, canvas, dropdown, dialogs, panels |
| `--t-fast` | `120ms ease-out` | color/background hover transitions |
| `--t-med` | `160ms ease-out` | dropdown/find-bar entry, urlbar ring |

All existing radii collapse to `--r-s`/`--r-m` (plus `999px` pills and `50%`
circles where semantically round). Floating panels (dropdown, find bar,
dialogs) use a `--shell` body with `--line` border; rows inside use
`--shell-raised` on hover and the wash colors when selected.

## Active tab: tinted, profile-aware

- Active row fill is a low-opacity wash of its profile color — `--accent-wash`
  for Default, `--work-wash` for Work — with text brightened toward the tint
  (`#cdd9f7` / `#edd9b8`). Applies to tabs, bookmark rows, and pins alike.
- Hover is tonal only (`--shell-raised`), never tinted; a fainter version of
  the active language.
- Asleep slots: reduced opacity on the row, exactly as today. No moon, no
  badge, no extra indicator (explicit user decision).
- Inactive Work rows keep their existing small amber profile dot.

## Chrome-aware profile accents

The chrome always knows which world the active tab is in, expressed in exactly
two places (user picked this over tab-only tint and over a full shell wash):

- **Urlbar focus ring**: 1.5px ring + faint outer glow in the active tab's
  profile color. Idle urlbar is neutral (`--well` + `--line`) in both worlds.
- **Canvas ring**: the 1px ring around the page canvas tints to the active
  profile at ~25% opacity.

Implementation: the renderer sets a `profile-work` class on `<body>` from the
`tabs:updated` snapshot (`TabInfo.profile` of the active tab); the ring/glow
colors derive from CSS vars switched by that class. No new IPC.

## Surface-by-surface

- **Topbar**: merges into the shell (no distinct raised background). Nav
  buttons get tonal hover circles/rounded-squares (`--r-s`).
- **Suggestions dropdown**: floating panel — `--shell` body, `--r-m`, `--line`
  border, `0 8px 24px rgba(0,0,0,.4)` shadow, 160ms fade + 4px slide in.
  Selected row uses the active-wash language.
- **Find bar / downloads shelf / dialogs**: same floating-panel treatment.
- **Settings page + AI sidebar**: retinted with shell/well tokens, unified
  radii and label style; no layout changes.
- **Scrollbars**: keep the v0.5.3 translucent pill (already fits).
- **Typography**: 13px system stack unchanged; consolidate to 11/12/13px roles
  plus the existing letter-spaced section-label style.

## Motion

Two durations only, both ease-out: `--t-fast` (120ms) for background/color on
hover and active states; `--t-med` (160ms) for panel entries (fade + 4px
translate) and the urlbar ring. No spring, no bounce, nothing above 200ms.
The existing `prefers-reduced-motion` block disables the panel translations.

## Out of scope

Light mode, new features, icon changes, tab-reorder animation, settings
layout redesign, any change to tab-model/stores/IPC shapes (beyond none —
there are none).

## Verification

- Unit suite must stay green untouched (pure logic is not modified).
- Runtime smoke via CDP screenshots of a dev instance: default state, urlbar
  focused (blue ring), Work tab active (amber ring + canvas tint via
  work-partition tab), suggestions open (canvas shift intact), overflowing
  sidebar, settings page, find bar.
- Validate `setBorderRadius` during live sidebar drag-resize early; if it
  artifacts, fallback is a square-cornered inset canvas keeping ring + gap
  (most of the effect survives).

## Risks

- `setBorderRadius` cutout note in Electron docs: the cut corners still
  capture clicks — acceptable (corners are page-edge pixels).
- The lighter shell changes perceived contrast of `--fg-dim` text; re-check
  legibility on real content during implementation.
- Canvas insets interact with `ui:set-overlay-height`; the dropdown shift must
  add to the top inset, not replace it (covered in smoke list).
