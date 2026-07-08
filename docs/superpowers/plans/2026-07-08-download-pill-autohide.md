# Download Pill Auto-Hide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The top-bar download pill hides itself 5 seconds after the latest download completes or fails.

**Architecture:** Renderer-only change inside `initTopbar()`: a module-scoped timer that is cleared on every downloads update and armed whenever the rendered state is terminal. No IPC, main-process, or CSS changes.

**Tech Stack:** TypeScript (vanilla renderer, no framework).

**Spec:** `docs/superpowers/specs/2026-07-08-download-pill-autohide-design.md`

## Global Constraints

- TypeScript strict; no new dependencies.
- 5000ms delay as a named constant (`PILL_HIDE_DELAY_MS`).
- Any downloads update clears the pending timer and re-shows the pill; `progressing` never auto-hides; `completed` and `failed` both auto-hide.
- Renderer code has no unit-test surface (repo convention) — verify with `npm run typecheck`, `npm test` (unchanged suite), and manual smoke.

---

### Task 1: Arm a hide timer for terminal download states

**Files:**
- Modify: `src/renderer/topbar.ts:12-41` (pill declarations + `renderPill`)

**Interfaces:**
- Consumes: existing `pill`, `latestDownload`, `window.synapse.downloads.onUpdated`.
- Produces: nothing new — behavior change only.

- [ ] **Step 1: Add the timer state and constant**

In `src/renderer/topbar.ts`, replace:

```ts
  const pill = document.getElementById('download-pill') as HTMLButtonElement
  let latestDownload: import('../shared/ipc').DownloadInfo | null = null
```

with:

```ts
  const pill = document.getElementById('download-pill') as HTMLButtonElement
  let latestDownload: import('../shared/ipc').DownloadInfo | null = null
  const PILL_HIDE_DELAY_MS = 5000
  let pillHideTimer: ReturnType<typeof setTimeout> | null = null
```

- [ ] **Step 2: Clear the timer on every render and arm it for terminal states**

Replace the whole `renderPill` function:

```ts
  function renderPill(): void {
    if (pillHideTimer) clearTimeout(pillHideTimer)
    pillHideTimer = null
    if (!latestDownload) {
      pill.hidden = true
      return
    }
    pill.hidden = false
    const d = latestDownload
    if (d.state === 'progressing') {
      const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0
      pill.textContent = `↓ ${d.filename} ${pct}%`
    } else {
      if (d.state === 'completed') {
        pill.textContent = `✓ ${d.filename}`
        pill.title = 'Show in Finder'
      } else {
        pill.textContent = `✕ ${d.filename}`
        pill.title = 'Download failed'
      }
      // finished chips linger briefly, then get out of the way
      pillHideTimer = setTimeout(() => {
        pill.hidden = true
      }, PILL_HIDE_DELAY_MS)
    }
  }
```

- [ ] **Step 3: Typecheck and run the suite**

Run: `npm run typecheck`
Expected: clean exit.

Run: `npm test`
Expected: PASS (143 tests, unchanged — no renderer tests exist).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/topbar.ts
git commit -m "feat: auto-hide download pill 5s after a download finishes"
```

- [ ] **Step 5: Manual smoke**

Restart the dev server if it predates this commit (electron-vite does not hot-reload renderer entry changes reliably for main/preload, but renderer edits do hot-reload; a restart is only needed if in doubt). Then:

1. Download a file (e.g. right-click an image → Download Image) → ✓ chip appears, disappears ~5s after completion.
2. Start a second download while a finished chip is visible → chip re-appears/updates and tracks the new download, then hides 5s after it finishes.
3. Click the ✓ chip within the 5s window → Show in Finder still works.
