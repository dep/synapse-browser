# Drag-to-Reorder Tabs/Pins + URL Bar Select-on-Click — Design

Date: 2026-07-06
Status: Approved

## Goal

1. Drag to reorder tabs within the sidebar tab list, and pins within the pin grid
   (within each list only; no cross-list drops).
2. Clicking the URL bar while it is unfocused selects its full contents; once
   focused, further clicks position the cursor normally.

## Reordering

### Model (`src/main/tab-model.ts` — pure, Vitest-covered)

One new method:

```ts
reorder(id: string, toIndex: number): void
```

- Finds `id` in whichever list holds it (`order` or `pinned`), removes it, and
  reinserts at `toIndex` clamped to `[0, list.length - 1]`, within that same list.
- `mru`, `activeId`, and cycling state are untouched — reordering is not a visit.
- Unknown ids are a no-op.

### Main process

- `TabManager.reorderTab(id: string, toIndex: number)`: call `model.reorder`, then
  `refresh()`. Persistence is free: `tabs.json` and `pins.json` already save from
  snapshot order on every refresh.
- New IPC channel `tabs:reorder` in `index.ts`, validating `id` is a string and
  coercing `toIndex` with `Number()`.

### API surface

`SynapseApi.tabs` gains `reorder(id: string, toIndex: number): void`
(`src/shared/ipc.ts` + the preload bridge).

### Renderer (`src/renderer/sidebar.ts` + `style.css`)

Native HTML5 drag-and-drop; no dependencies.

- Tab rows and pin buttons get `draggable = true`. `dragstart` records the dragged
  tab id and its list kind (`'tab' | 'pin'`) in module state and via
  `dataTransfer.setData('text/plain', id)`; `dragend` clears state and indicators.
- `dragover` on a row/button whose list kind matches the drag: `preventDefault()`
  (allows drop) and show an insertion indicator — before/after based on pointer
  position within the target's bounding box (top/bottom half for vertical tab rows,
  left/right half for pin-grid buttons). Indicator is a CSS class rendering a 2px
  accent line (`.drop-before` / `.drop-after`).
- `drop` computes the destination index in snapshot terms: the target's index in
  the rendered list, adjusted −1 when the dragged item currently sits before the
  target and the drop is "before" (or equivalent standard index math), then calls
  `window.synapse.tabs.reorder(draggedId, toIndex)`. The snapshot round-trip
  re-renders the new order; no local DOM mutation.
- The tab-list container itself accepts drops below the last row → append to end.
- Cross-list drags show no indicator and drop is ignored (no `preventDefault`).
- Renderers keep zero retained tab state: drag bookkeeping is transient gesture
  state only, cleared on `dragend`/`drop`.

## URL bar select-on-click (`src/renderer/topbar.ts`)

Standard browser behavior: first click selects all, later clicks place the cursor.

```ts
let selectOnMouseUp = false
urlbar.addEventListener('mousedown', () => {
  selectOnMouseUp = document.activeElement !== urlbar
})
urlbar.addEventListener('mouseup', (e) => {
  if (!selectOnMouseUp) return
  selectOnMouseUp = false
  e.preventDefault() // default mouseup would collapse the selection
  urlbar.select()
})
```

The existing Cmd-L path (`onFocusUrlBar` → `focus()` + `select()`) is unchanged.

## Error handling

- `reorder` with an out-of-range index clamps; with an unknown id, no-ops.
- Malformed IPC payloads (non-string id, non-numeric index) are ignored in main.
- A drag ending outside any valid target simply clears indicators (native
  `dragend`), leaving order unchanged.

## Testing

- Vitest (`tests/tab-model.test.ts`): move forward/back within `order`, reorder
  within `pinned`, clamping, unknown-id no-op, and invariants (mru/activeId
  unchanged by reorder).
- Manual smoke: drag tabs up/down (indicator position, drop lands correctly,
  active tab stays active), reorder pins in the grid, verify order survives
  restart, tab drag over pin grid does nothing (and vice versa), URL bar click
  selects all then second click places cursor, Cmd-L still selects.

## Out of scope

- Cross-list drag (pin-by-drag / unpin-by-drag).
- Dragging tabs between windows; multi-select drag.
- Animated drop transitions.
