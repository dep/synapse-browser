# Tab Reorder + URL Bar Select-on-Click Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag-to-reorder tabs within the sidebar list and pins within the pin grid, plus select-all-on-click for the URL bar.

**Architecture:** `TabModel` (pure) gains `reorder(id, toIndex)`; a new `tabs:reorder` IPC channel carries drops from the renderer; the sidebar wires native HTML5 drag-and-drop per rendered item with a CSS insertion indicator. Order persistence is free — stores already save from snapshot order. The URL bar select uses the mousedown/mouseup pair so the browser's default mouseup doesn't collapse the selection.

**Tech Stack:** TypeScript strict, native HTML5 DnD (no dependencies), Vitest for the pure model.

Spec: `docs/superpowers/specs/2026-07-06-tab-reorder-urlbar-select-design.md`

## Global Constraints

- TypeScript strict; `npm run typecheck` clean and `npm test` green at every commit (no cross-task type gaps in this plan).
- No new runtime npm dependencies; no UI framework in the renderer.
- Renderer keeps zero retained tab state — drag bookkeeping is transient gesture state cleared on dragend/drop.
- Reordering must NOT touch `mru`, `activeId`, or cycling state.
- Commits: short conventional (`feat:`, `test:`); no backticks in commit messages.

---

### Task 1: TabModel.reorder

**Files:**
- Modify: `src/main/tab-model.ts` (add one method after `addPin`)
- Test: `tests/tab-model.test.ts` (append a describe block)

**Interfaces:**
- Produces: `TabModel.reorder(id: string, toIndex: number): void` — moves `id` within whichever list holds it (`order` or `pinned`); `toIndex` is the insertion index AFTER removal (so `list.length` post-removal = append); clamps out-of-range; unknown id is a no-op. Task 2 calls it from `TabManager`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tab-model.test.ts` inside the top-level `describe('TabModel', ...)`:

```ts
  describe('reorder', () => {
    it('moves a tab toward the end', () => {
      m.reorder('a', 2)
      expect(m.order).toEqual(['b', 'c', 'a'])
    })

    it('moves a tab toward the front', () => {
      m.reorder('c', 0)
      expect(m.order).toEqual(['c', 'a', 'b'])
    })

    it('clamps out-of-range indices', () => {
      m.reorder('a', 99)
      expect(m.order).toEqual(['b', 'c', 'a'])
      m.reorder('a', -5)
      expect(m.order).toEqual(['a', 'b', 'c'])
    })

    it('reorders pins within the pinned list only', () => {
      m.pin('a')
      m.pin('b') // pinned [a, b], order [c]
      m.reorder('b', 0)
      expect(m.pinned).toEqual(['b', 'a'])
      expect(m.order).toEqual(['c'])
    })

    it('does not touch mru or activeId', () => {
      m.reorder('a', 2)
      expect(m.mru).toEqual(['c', 'b', 'a'])
      expect(m.activeId).toBe('c')
    })

    it('ignores unknown ids', () => {
      m.reorder('nope', 1)
      expect(m.order).toEqual(['a', 'b', 'c'])
      expect(m.pinned).toEqual([])
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tab-model.test.ts`
Expected: FAIL — `m.reorder is not a function`.

- [ ] **Step 3: Implement reorder**

In `src/main/tab-model.ts`, after `addPin`:

```ts
  // move a tab within its own list (sidebar order or pin row); not a visit,
  // so MRU and activeId are untouched. toIndex is the insertion index after
  // removal; out-of-range clamps, unknown ids no-op.
  reorder(id: string, toIndex: number): void {
    const list = this.order.includes(id) ? this.order : this.pinned.includes(id) ? this.pinned : null
    if (!list) return
    list.splice(list.indexOf(id), 1)
    list.splice(Math.min(Math.max(toIndex, 0), list.length), 0, id)
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tab-model.test.ts`
Expected: PASS (all cases including the 6 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/main/tab-model.ts tests/tab-model.test.ts
git commit -m "feat: TabModel.reorder for tabs and pins"
```

---

### Task 2: IPC plumbing for tabs:reorder

**Files:**
- Modify: `src/shared/ipc.ts` (SynapseApi.tabs)
- Modify: `src/preload/index.ts` (bridge)
- Modify: `src/main/tab-manager.ts` (public method)
- Modify: `src/main/index.ts` (ipcMain handler)

**Interfaces:**
- Consumes: `TabModel.reorder(id, toIndex)` from Task 1.
- Produces: `SynapseApi.tabs.reorder(id: string, toIndex: number): void` (Task 3 calls it from the renderer); `TabManager.reorderTab(id: string, toIndex: number): void`.

- [ ] **Step 1: Add reorder to the typed API**

In `src/shared/ipc.ts`, inside `SynapseApi.tabs` after `reload`:

```ts
    reorder(id: string, toIndex: number): void
```

- [ ] **Step 2: Bridge it in the preload**

In `src/preload/index.ts`, inside `tabs` after `reload`:

```ts
    reorder: (id, toIndex) => ipcRenderer.send('tabs:reorder', id, toIndex),
```

- [ ] **Step 3: Add TabManager.reorderTab**

In `src/main/tab-manager.ts`, after `reload(id)`:

```ts
  reorderTab(id: string, toIndex: number): void {
    if (!Number.isFinite(toIndex)) return
    this.model.reorder(id, Math.round(toIndex))
    this.refresh()
  }
```

- [ ] **Step 4: Handle the channel in main**

In `src/main/index.ts`, after the `tabs:reload` handler:

```ts
  ipcMain.on('tabs:reorder', (_e, id: string, toIndex: number) => {
    if (typeof id === 'string') tabs.reorderTab(id, Number(toIndex))
  })
```

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck` → clean. Run: `npx vitest run` → all pass.

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/tab-manager.ts src/main/index.ts
git commit -m "feat: tabs:reorder IPC channel"
```

---

### Task 3: Sidebar drag-and-drop

**Files:**
- Modify: `src/renderer/sidebar.ts`
- Modify: `src/renderer/style.css`

**Interfaces:**
- Consumes: `window.synapse.tabs.reorder(id, toIndex)` from Task 2; `TabInfo`/snapshot shape unchanged.
- Produces: nothing for later tasks.

**Index math contract (matches Task 1):** `toIndex` is the position in the list with the dragged item removed. Drop-before target at rendered index `i` → `to = i`; drop-after → `to = i + 1`; then `if (from < to) to -= 1` where `from` is the dragged item's rendered index.

- [ ] **Step 1: Add drag wiring to sidebar.ts**

At the top of `src/renderer/sidebar.ts` (below the import), add module-level gesture state and helpers:

```ts
type DragKind = 'tab' | 'pin'
let drag: { id: string; kind: DragKind } | null = null
let lastOrder: string[] = []
const wiredContainers = new WeakSet<HTMLElement>()

function clearIndicators(): void {
  for (const el of document.querySelectorAll('.drop-before, .drop-after')) {
    el.classList.remove('drop-before', 'drop-after')
  }
}

// vertical lists split rows top/bottom; the pin grid splits buttons left/right
function isBefore(e: DragEvent, el: HTMLElement, vertical: boolean): boolean {
  const r = el.getBoundingClientRect()
  return vertical ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2
}

function wireDrag(el: HTMLElement, id: string, kind: DragKind, index: number, list: string[], vertical: boolean): void {
  el.draggable = true
  el.addEventListener('dragstart', (e) => {
    drag = { id, kind }
    e.dataTransfer?.setData('text/plain', id)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  })
  el.addEventListener('dragend', () => {
    drag = null
    clearIndicators()
  })
  el.addEventListener('dragover', (e) => {
    if (!drag || drag.kind !== kind || drag.id === id) return
    e.preventDefault()
    clearIndicators()
    el.classList.add(isBefore(e, el, vertical) ? 'drop-before' : 'drop-after')
  })
  el.addEventListener('drop', (e) => {
    if (!drag || drag.kind !== kind || drag.id === id) return
    e.preventDefault()
    e.stopPropagation() // the tab-list container would otherwise treat this as an append
    const from = list.indexOf(drag.id)
    let to = index + (isBefore(e, el, vertical) ? 0 : 1)
    if (from < to) to -= 1
    window.synapse.tabs.reorder(drag.id, to)
    drag = null
    clearIndicators()
  })
}

// dropping on empty space below the rows appends to the end of the tab list
function wireListDrop(el: HTMLElement): void {
  if (wiredContainers.has(el)) return
  wiredContainers.add(el)
  el.addEventListener('dragover', (e) => {
    if (drag?.kind === 'tab') e.preventDefault()
  })
  el.addEventListener('drop', (e) => {
    if (drag?.kind !== 'tab') return
    e.preventDefault()
    window.synapse.tabs.reorder(drag.id, lastOrder.length - 1)
    drag = null
    clearIndicators()
  })
}
```

- [ ] **Step 2: Wire items during render**

In `renderPins`, after the `contextmenu` listener and before `el.append(btn)`, add (using the loop's `id`; convert the `for...of` over `snap.pinned` to `snap.pinned.forEach((id, i) => { ... })` so the index is available):

```ts
    wireDrag(btn, id, 'pin', i, snap.pinned, false)
```

In `renderTabList`, first line of the function body:

```ts
  wireListDrop(el)
  lastOrder = snap.order
```

and in the loop (convert `for...of` over `snap.order` to `snap.order.forEach((id, i) => { ... })`), after the `contextmenu` listener:

```ts
    wireDrag(item, id, 'tab', i, snap.order, true)
```

- [ ] **Step 3: Indicator styles**

Append to `src/renderer/style.css`:

```css
.tab.drop-before {
  box-shadow: 0 -2px 0 0 var(--accent);
}
.tab.drop-after {
  box-shadow: 0 2px 0 0 var(--accent);
}
.pin.drop-before {
  box-shadow: -2px 0 0 0 var(--accent);
}
.pin.drop-after {
  box-shadow: 2px 0 0 0 var(--accent);
}
```

(These override the `.pin.work` inset ring only while hovering a drop position — acceptable transient.)

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck` → clean. Run: `npx vitest run` → all pass.

```bash
git add src/renderer/sidebar.ts src/renderer/style.css
git commit -m "feat: drag-to-reorder tabs and pins in the sidebar"
```

---

### Task 4: URL bar select-on-click

**Files:**
- Modify: `src/renderer/topbar.ts`

**Interfaces:** none new.

- [ ] **Step 1: Add the mousedown/mouseup pair**

In `src/renderer/topbar.ts`, directly after the `urlbar.addEventListener('blur', ...)` line:

```ts
  // first click selects the whole url; once focused, clicks place the cursor.
  // select() must run on mouseup (with default prevented) because the
  // browser's default mouseup collapses the selection made on focus.
  let selectOnMouseUp = false
  urlbar.addEventListener('mousedown', () => {
    selectOnMouseUp = document.activeElement !== urlbar
  })
  urlbar.addEventListener('mouseup', (e) => {
    if (!selectOnMouseUp) return
    selectOnMouseUp = false
    e.preventDefault()
    urlbar.select()
  })
```

- [ ] **Step 2: Verify and commit**

Run: `npm run typecheck` → clean. Run: `npx vitest run` → all pass.

```bash
git add src/renderer/topbar.ts
git commit -m "feat: url bar selects all on first click"
```

---

### Task 5: Full verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Full automated pass**

```bash
npm run typecheck && npx vitest run
```

Expected: zero type errors; all suites pass.

- [ ] **Step 2: Manual smoke (npm run dev)**

1. Drag a tab down two slots — accent line shows above/below rows as you hover; drop lands it exactly where the line was; the active tab stays active.
2. Drag a tab to the empty space below the list — it moves to the end.
3. Reorder two pins in the grid — left/right accent line, drop swaps them.
4. Drag a tab over the pin grid — no indicator, drop does nothing (and a pin over the tab list likewise).
5. Restart the app — tab order and pin order both restore as dragged.
6. Ctrl+Tab (MRU cycling) order is unaffected by dragging; Option+Tab walks the NEW sidebar order.
7. Click the URL bar from an unfocused state — whole URL selects; click again — cursor places normally; Cmd-L still selects all.
