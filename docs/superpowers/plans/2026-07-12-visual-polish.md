# Carved Canvas Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Carved Canvas visual polish (spec: `docs/superpowers/specs/2026-07-12-visual-polish-design.md`) — one continuous shell, rounded floating page canvas, tinted profile-aware active tabs, chrome-aware accents, token system, micro-motion — and release as 0.6.0.

**Architecture:** A pure shared module owns canvas geometry (main sizes the `WebContentsView`; the renderer paints the matching frame). All theming is CSS-token work in the chrome renderer. No tab-model/store/IPC changes.

**Tech Stack:** Electron 43 (`View.setBorderRadius`), electron-vite, vanilla TS renderer, Vitest.

## Global Constraints

- TypeScript strict; pure logic in Electron-free modules with Vitest coverage (`.agents/REPO_RULES.md`).
- No new runtime npm dependencies. No UI framework.
- Exactly two radii tokens (6px, 8px) + `999px` pills / `50%` circles; two motion durations (120ms, 160ms ease-out).
- Colors: shell `#26272d`, shell-raised `#31323a`, well `#1c1d22`, line `rgba(255,255,255,.07)`, accent-wash `rgba(122,162,247,.14)`, work-wash `rgba(224,175,104,.15)`, active text `#cdd9f7` / `#edd9b8`, canvas rings at 25% profile color.
- Asleep slots: opacity fade only — no moon, no badge (explicit user decision).
- Short conventional commits.

---

### Task 1: Shared canvas geometry (pure, TDD)

**Files:**
- Create: `src/shared/canvas-layout.ts`
- Test: `tests/canvas-layout.test.ts`

**Interfaces:**
- Produces: `CANVAS_GAP = 8`, `CANVAS_RADIUS = 8`, `computeCanvasBounds(w: number, h: number, i: {topbar: number; overlay: number; sidebar: number; ai: number}): {x: number; y: number; width: number; height: number}` — consumed by Task 2 (main) and Task 3 (renderer imports the constants only).

- [ ] **Step 1: Write the failing test** (`tests/canvas-layout.test.ts`):

```ts
import { describe, expect, it } from 'vitest'
import { CANVAS_GAP, computeCanvasBounds } from '../src/shared/canvas-layout'

describe('computeCanvasBounds', () => {
  it('insets the page view by the gap on all sides inside the chrome', () => {
    const b = computeCanvasBounds(1200, 800, { topbar: 52, overlay: 0, sidebar: 240, ai: 0 })
    expect(b).toEqual({
      x: 240 + CANVAS_GAP,
      y: 52 + CANVAS_GAP,
      width: 1200 - 240 - CANVAS_GAP * 2,
      height: 800 - 52 - CANVAS_GAP * 2,
    })
  })

  it('adds the overlay shift below the topbar', () => {
    const b = computeCanvasBounds(1200, 800, { topbar: 52, overlay: 120, sidebar: 240, ai: 0 })
    expect(b.y).toBe(52 + 120 + CANVAS_GAP)
    expect(b.height).toBe(800 - 52 - 120 - CANVAS_GAP * 2)
  })

  it('handles hidden sidebar and visible AI sidebar', () => {
    const b = computeCanvasBounds(1200, 800, { topbar: 52, overlay: 0, sidebar: 0, ai: 360 })
    expect(b.x).toBe(CANVAS_GAP)
    expect(b.width).toBe(1200 - 360 - CANVAS_GAP * 2)
  })

  it('clamps width/height at 0 for tiny windows', () => {
    const b = computeCanvasBounds(200, 40, { topbar: 52, overlay: 0, sidebar: 240, ai: 0 })
    expect(b.width).toBe(0)
    expect(b.height).toBe(0)
  })
})
```

- [ ] **Step 2: Run** `npx vitest run tests/canvas-layout.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `src/shared/canvas-layout.ts`:

```ts
// geometry shared by main (positions the WebContentsView) and the chrome
// renderer (paints the matching frame behind it)
export const CANVAS_GAP = 8
export const CANVAS_RADIUS = 8

export interface CanvasInsets {
  topbar: number
  overlay: number
  sidebar: number
  ai: number
}

export function computeCanvasBounds(
  w: number,
  h: number,
  i: CanvasInsets,
): { x: number; y: number; width: number; height: number } {
  const x = i.sidebar + CANVAS_GAP
  const y = i.topbar + i.overlay + CANVAS_GAP
  return {
    x,
    y,
    width: Math.max(0, w - x - i.ai - CANVAS_GAP),
    height: Math.max(0, h - y - CANVAS_GAP),
  }
}
```

- [ ] **Step 4: Run** the test again — expect PASS. Run `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: shared canvas geometry for carved-canvas layout`

### Task 2: Main process — inset + rounded page view

**Files:**
- Modify: `src/main/tab-manager.ts` (`createView` ~line 76, `layout()` ~line 618)

**Interfaces:**
- Consumes: `computeCanvasBounds`, `CANVAS_RADIUS` from Task 1.

- [ ] **Step 1:** Import in `tab-manager.ts`: `import { CANVAS_RADIUS, computeCanvasBounds } from '../shared/canvas-layout'`.
- [ ] **Step 2:** In `createView`, after `const view = new WebContentsView({...})`, add `view.setBorderRadius(CANVAS_RADIUS)`.
- [ ] **Step 3:** Replace the `layout()` body:

```ts
private layout(): void {
  if (!this.attached) return
  const [w, h] = this.win.getContentSize()
  this.attached.setBounds(
    computeCanvasBounds(w, h, {
      topbar: TOPBAR_HEIGHT,
      overlay: this.overlayHeight,
      sidebar: this.sidebarVisible ? this.sidebarWidth : 0,
      ai: this.aiSidebarVisible ? this.aiSidebarWidth : 0,
    }),
  )
}
```

- [ ] **Step 4:** `npm run typecheck && npm test` — expect all green (no behavioral unit coverage of layout; geometry covered by Task 1).
- [ ] **Step 5: Commit** `feat: page view floats as rounded inset canvas`

### Task 3: Renderer plumbing — canvas frame, overlay var, profile classes

**Files:**
- Modify: `src/renderer/index.html` (insert after `</header>`, line 38)
- Modify: `src/renderer/main.ts` (imports, `render()`)
- Modify: `src/renderer/topbar.ts` (all `setOverlayHeight` call sites: lines 75, 82, 101, 124)
- Modify: `src/renderer/sidebar.ts` (tab row builder ~line 57), `src/renderer/bookmarks-section.ts` (row builder ~line 92)

**Interfaces:**
- Consumes: `CANVAS_GAP` from Task 1; `TabInfo.profile` from snapshots.
- Produces for Task 4 (CSS): `#canvas-frame > #canvas-well` elements; `--overlay-shift` and `--gap` CSS vars on `#app`; `profile-work` class on `<body>`; `.work` class on active-able rows (`.tab`, `.pin` already has it).

- [ ] **Step 1:** `index.html` — after `</header>` insert:

```html
<div id="canvas-frame"><div id="canvas-well"></div></div>
```

- [ ] **Step 2:** `topbar.ts` — add a local helper and use it at all four call sites so the frame padding tracks the page-view shift from one origin:

```ts
function setOverlay(px: number): void {
  document.getElementById('app')!.style.setProperty('--overlay-shift', `${px}px`)
  window.synapse.ui.setOverlayHeight(px)
}
```

- [ ] **Step 3:** `main.ts` — `import { CANVAS_GAP } from '../shared/canvas-layout'`; after `appEl` init: `appEl.style.setProperty('--gap', `${CANVAS_GAP}px`)`. In `render()` add:

```ts
const activeProfile = snap.activeId ? snap.tabs[snap.activeId]?.profile : undefined
document.body.classList.toggle('profile-work', activeProfile === 'work')
```

- [ ] **Step 4:** `sidebar.ts` tab builder: after `item.className = 'tab' + ...` add `if (tab.profile === 'work') item.classList.add('work')`. Same in `bookmarks-section.ts` row builder (`row.className = 'tab bookmark' + ...` → append `' work'` when the awake tab's profile — or the bookmark's `profile` field — is `'work'`).
- [ ] **Step 5:** `npm run typecheck` — PASS. **Commit** `feat: canvas frame, overlay var, and profile classes in chrome renderer`

### Task 4: The token system — style.css overhaul

**Files:**
- Modify: `src/renderer/style.css` (whole file pass)

**Interfaces:** consumes Task 3's elements/classes/vars. Exact value mapping (old → new):

- [ ] **Step 1: Tokens.** Replace the `:root` block variables with:

```css
:root {
  color-scheme: dark;
  --shell: #26272d;
  --shell-raised: #31323a;
  --well: #1c1d22;
  --line: rgba(255, 255, 255, 0.07);
  --fg: #e6e6ea;
  --fg-dim: #9a9aa3;
  --accent: #7aa2f7;
  --work: #e0af68;
  --accent-wash: rgba(122, 162, 247, 0.14);
  --work-wash: rgba(224, 175, 104, 0.15);
  --active-fg: #cdd9f7;
  --work-active-fg: #edd9b8;
  --focus-ring: var(--accent);
  --focus-glow: rgba(122, 162, 247, 0.18);
  --canvas-ring: rgba(122, 162, 247, 0.25);
  --r-s: 6px;
  --r-m: 8px;
  --t-fast: 120ms ease-out;
  --t-med: 160ms ease-out;
}
body.profile-work {
  --focus-ring: var(--work);
  --focus-glow: rgba(224, 175, 104, 0.18);
  --canvas-ring: rgba(224, 175, 104, 0.25);
}
```

Remove `--bg`/`--bg-raised` and migrate every usage: `var(--bg)` → `var(--well)` for inputs/urlbar/find-bar, `var(--shell)` for full surfaces (body, settings, AI sidebar); `var(--bg-raised)` → `var(--shell)` for panels (suggestions, ext-menu), `var(--shell-raised)` for hovers/chips/inputs-on-shell, `var(--accent-wash)` for active rows.

- [ ] **Step 2: Canvas frame.**

```css
#canvas-frame {
  grid-row: 2;
  grid-column: 2;
  min-width: 0;
  min-height: 0;
  padding: calc(var(--overlay-shift, 0px) + var(--gap, 8px)) var(--gap, 8px) var(--gap, 8px);
}
#canvas-well {
  height: 100%;
  border-radius: var(--r-m);
  background: var(--well);
  box-shadow:
    0 0 0 1px var(--canvas-ring),
    0 2px 12px rgba(0, 0, 0, 0.35);
  transition: box-shadow var(--t-med);
}
```

- [ ] **Step 3: Shell merge.** `body { background: var(--shell) }`; `#topbar { background: transparent }` (seam gone). `#ai-sidebar { background: var(--shell); border-left: 1px solid var(--line) }`; `#settings { background: var(--shell) }`; `#bookmarks { border-bottom-color: var(--line) }`; `#ai-header`/`#ai-composer` borders → `var(--line)`.
- [ ] **Step 4: Urlbar.** Idle: `background: var(--well); border: 1px solid var(--line); transition: box-shadow var(--t-med), border-color var(--t-med)`. Focus: `border-color: transparent; box-shadow: 0 0 0 1.5px var(--focus-ring), 0 0 12px var(--focus-glow)`.
- [ ] **Step 5: Active/hover language.** All row hovers (`.tab:hover`, `.pin:hover`, `.panel-item:hover`, `.settings-nav-item:hover`, `.shortcut-row:hover`, `#sidebar-footer button:hover`, `#topbar button:hover`) → `background: var(--shell-raised)`, with `transition: background var(--t-fast), color var(--t-fast)` on the base class. Actives: `.tab.active, .pin.active, .settings-nav-item.active { background: var(--accent-wash); color: var(--active-fg) }` and `.tab.active.work, .pin.active.work { background: var(--work-wash); color: var(--work-active-fg) }` (pins keep their existing inset `--work` ring for slot identity).
- [ ] **Step 6: Floating panels.** `#suggestions, #ext-menu { background: var(--shell); border: 1px solid var(--line); border-radius: var(--r-m); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); animation: panel-in var(--t-med) }` plus `@keyframes panel-in { from { opacity: 0; transform: translateY(-4px) } }`. `.suggestion:hover { background: var(--shell-raised) }`, `.suggestion.selected { background: var(--accent-wash) }`. `#find-bar { background: var(--well); border: 1px solid var(--line); border-radius: var(--r-m) }`, `#find-input { background: transparent; border: none }`.
- [ ] **Step 7: Radius collapse.** 4px/5px/6px → `var(--r-s)`; 8px/10px/12px → `var(--r-m)`; keep `999px`, `50%`, the loading-bar `0 1px 1px 0`, and the AI bubbles' 4px corner-cut accents. Inputs (`.settings-input`, `.folder-input`, `.shortcut-chip`, `#ai-input`) → `var(--well)` bg + `var(--line)` border, focus `border-color: var(--focus-ring)`.
- [ ] **Step 8: Reduced motion.** Extend the existing `@media (prefers-reduced-motion: reduce)` block: `#suggestions, #ext-menu { animation: none } * { transition-duration: 0ms }` scoped to the panel/hover transitions added above (use explicit selectors, not a global `*`).
- [ ] **Step 9:** `npm run typecheck && npm test && npm run build` — all green. **Commit** `feat: carved-canvas token system and micro-motion across the chrome`

### Task 5: Runtime visual verification (CDP)

**Files:** none (scratchpad script + screenshots)

- [ ] **Step 1:** Launch dev instance (`SYNAPSE_USER_DATA=/tmp/synapse-verify/profile`, port 9223, fresh profile). Raise the window frontmost (occluded windows freeze rAF).
- [ ] **Step 2:** Screenshot states via CDP on the chrome UI target: (a) default tab active — blue wash row, blue canvas ring, seamless shell; (b) urlbar focused — blue ring + glow; (c) `document.body.classList.add('profile-work')` — amber ring/urlbar (CSS proof; the snapshot wiring is 3 typechecked lines); (d) suggestions open — panel styling, canvas shifted below dropdown, frame padding tracks; (e) overflowing sidebar; (f) settings open; (g) find bar open; (h) sidebar drag-resize while watching for `setBorderRadius` artifacts.
- [ ] **Step 3:** Fix anything visually broken; re-screenshot; commit fixes as `fix:` commits.

### Task 6: Self-review and release 0.6.0

- [ ] **Step 1:** Run the code-review pass (finder angles + verify) on the accumulated diff; fix confirmed findings.
- [ ] **Step 2:** `npm run typecheck && npm test && npm run build` all green.
- [ ] **Step 3:** Follow `.agents/commands/RELEASE.md` for 0.6.0: bump, `dist:mac` (CSC_NAME + APPLE_KEYCHAIN_PROFILE), codesign/spctl/stapler verify, commit+push, `gh release create 0.6.0` with notes, appcast item scripted from `sign_update` output, verify with the repo parser, push.

## Self-review notes

- Spec coverage: shell/canvas (T2/T3/T4), tokens (T4.1), tinted active + work rows (T3.4/T4.5), chrome-aware accents (T4.1/T4.2/T4.4), panels/motion (T4.6/T4.8), settings/AI retint (T4.3/T4.7), scrollbars already done in 0.5.3, verification (T5), release (T6). No gaps.
- Overlay interplay (spec risk 3): handled by `--overlay-shift` set at the same origin as `setOverlayHeight` (T3.2) and added to frame padding (T4.2) and view y (T1/T2).
- Type consistency: `computeCanvasBounds`/`CANVAS_GAP`/`CANVAS_RADIUS` names match across T1–T3.
