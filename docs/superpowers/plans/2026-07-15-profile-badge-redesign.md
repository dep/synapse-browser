# Profile Badge Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating orange `.profile-dot` with a favicon ring (tabs, loose work bookmarks), an orange-tinted count badge (work folders), and no mark at all on bookmarks whose folder already implies their profile.

**Architecture:** Renderer-only change. A new shared helper `rowIcon()` centralizes the favicon/spinner icon block currently duplicated in `sidebar.ts` and `bookmarks-section.ts`, and owns the ring + missing-favicon behavior. Main already hydrates bookmarks with their *effective* profile (`src/main/bookmarks.ts`), so the renderer decides "mark or not" with one comparison: item profile vs container profile.

**Tech Stack:** TypeScript (strict), vanilla DOM, plain CSS. No main-process or IPC changes.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-15-profile-badge-redesign-design.md`
- Ring: `box-shadow: 0 0 0 1.5px var(--work)` on the icon slot, small border-radius (matches `.pin.work` weight).
- Folder count tint is color-only (`var(--work)`), no weight/size change.
- Keep `.tab.active.work` / `.pin.active.work` washes and `.pin.work` ring unchanged.
- Keep the row-level `work` class in `sidebar.ts:59` and `bookmarks-section.ts:98` — the active wash depends on it; the ring is a separate, narrower condition.
- Missing/failed favicon on a marked row still shows the ring around an empty slot (no broken-image glyph).
- All verification is manual smoke (repo convention for Electron-coupled renderer code) plus `npm run typecheck` and `npm test`.
- Short conventional commits; no backticks in commit messages.

---

### Task 1: Shared `rowIcon()` helper + ring CSS, adopted by tab rows

**Files:**
- Create: `src/renderer/row-icon.ts`
- Modify: `src/renderer/sidebar.ts:61-93` (icon block + dot removal)
- Modify: `src/renderer/style.css` (add `.favicon.work-ring` rule near `.favicon` at line 297)

**Interfaces:**
- Consumes: `loadSpinner()` from `./load-spinner`.
- Produces: `rowIcon(favicon: string | undefined, isLoading: boolean, workMark: boolean): HTMLElement` — Task 2 calls this from `bookmarks-section.ts`.

- [ ] **Step 1: Create the helper**

```ts
// src/renderer/row-icon.ts
import { loadSpinner } from './load-spinner'

// Favicon slot for a sidebar row. workMark draws the work-profile ring; a
// marked row keeps the slot visible (hollow ring) when the favicon is
// missing or fails, instead of hiding it.
export function rowIcon(
  favicon: string | undefined,
  isLoading: boolean,
  workMark: boolean,
): HTMLElement {
  if (isLoading) return loadSpinner()
  const img = document.createElement('img')
  img.className = 'favicon' + (workMark ? ' work-ring' : '')
  if (workMark) img.title = 'Work profile'
  img.onerror = () => {
    // dropping src clears the broken-image glyph so the ring stands alone
    img.removeAttribute('src')
    if (!workMark) img.style.visibility = 'hidden'
  }
  if (favicon) img.src = favicon
  else if (!workMark) img.style.visibility = 'hidden'
  return img
}
```

- [ ] **Step 2: Add the ring CSS**

In `src/renderer/style.css`, directly after the `.favicon` block (line 297):

```css
.favicon.work-ring {
  border-radius: 4px;
  box-shadow: 0 0 0 1.5px var(--work);
}
```

- [ ] **Step 3: Use it in `sidebar.ts`**

Replace lines 61-71 (the `let icon` block) with:

```ts
    const icon = rowIcon(tab.favicon, tab.isLoading, tab.profile === 'work')
```

Add the import at the top, replacing the now-unused `loadSpinner` import:

```ts
import { rowIcon } from './row-icon'
```

Replace the dot branch at lines 86-93 with a single unconditional append:

```ts
    item.append(icon, title, close)
```

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: both pass (no `profile-dot` references remain in `sidebar.ts`; `loadSpinner` import removed).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/row-icon.ts src/renderer/sidebar.ts src/renderer/style.css
git commit -m "feat: work-profile ring on tab favicons via shared rowIcon helper"
```

---

### Task 2: Bookmark + folder rows — inherit-aware marks, count tint, dot removal

**Files:**
- Modify: `src/renderer/bookmarks-section.ts` (bookmarkRow, folderRow, call sites)
- Modify: `src/renderer/style.css` (add `.folder.work .folder-count` after `.folder-count` at line 448; delete `.profile-dot` block at line 343)

**Interfaces:**
- Consumes: `rowIcon(favicon, isLoading, workMark)` from `./row-icon` (Task 1).
- Produces: `bookmarkRow(bm, index, siblings, indented, snap, containerProfile: ProfileId)` — internal to this file.

- [ ] **Step 1: Thread the container profile into `bookmarkRow`**

Add `ProfileId` to the type import at line 1:

```ts
import type { Bookmark, BookmarkFolder, BookmarksData, ProfileId, TabsSnapshot } from '../shared/ipc'
```

Change the `bookmarkRow` signature (line 83-89) to:

```ts
function bookmarkRow(
  bm: Bookmark,
  index: number,
  siblings: Bookmark[],
  indented: boolean,
  snap: TabsSnapshot,
  containerProfile: ProfileId,
): HTMLDivElement {
```

Update the two call sites in `renderBookmarks`:
- Folder members (line 57): `bookmarkRow(bm, j, members, true, snap, folder.profile ?? 'default')`
- Loose bookmarks (line 70): `bookmarkRow(bm, j, topLevel, false, snap, 'default')`

- [ ] **Step 2: Replace the icon block and dot with a marked `rowIcon`**

Add the import:

```ts
import { rowIcon } from './row-icon'
```

Remove the `loadSpinner` import (now unused). Replace the icon block (lines 100-111) with:

```ts
  // main hydrates bm.profile to the effective profile, so a mark is only
  // needed where it disambiguates: profile differs from the container's
  const marked = (bm.profile ?? 'default') !== containerProfile
  const icon = rowIcon(tab?.favicon ?? bm.favicon, tab?.isLoading ?? false, marked)
```

Delete the dot branch (lines 118-123, the `if ((bm.profile ?? 'default') === 'work')` block). Keep `row.append(icon, title)` as-is.

- [ ] **Step 3: Tint the folder count instead of appending a dot**

In `folderRow`, replace the dot branch (lines 190-195) with a class + tooltip:

```ts
  if (folder.profile === 'work') {
    row.classList.add('work')
    countEl.title = 'Work profile'
  }
```

- [ ] **Step 4: CSS — add count tint, delete `.profile-dot`**

After the `.folder-count` block (line 448):

```css
.folder.work .folder-count {
  color: var(--work);
}
```

Delete the `.profile-dot` block (line 343):

```css
.profile-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--work);
}
```

- [ ] **Step 5: Verify no dot references remain, typecheck, test**

Run: `grep -rn "profile-dot" src/ ; npm run typecheck && npm test`
Expected: grep finds nothing; typecheck and tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/bookmarks-section.ts src/renderer/style.css
git commit -m "feat: inherit-aware work marks for bookmarks, tinted folder counts"
```

---

### Task 3: Manual smoke verification

**Files:** none (verification only)

**Interfaces:** n/a

- [ ] **Step 1: Launch a dev instance**

Use the `verify` skill to launch and drive a dev instance of Synapse Browser.

- [ ] **Step 2: Smoke the spec's checklist**

- Plain Default tab: no ring, no dot anywhere.
- Plain Work tab: orange ring around its favicon, tooltip "Work profile"; active Work tab still gets the work wash.
- Work folder with children: folder count tinted orange with tooltip; children show NO mark.
- Loose Work bookmark: ring around favicon.
- Work bookmark inside a Default folder: ring around favicon.
- Work row with missing favicon: hollow ring, no broken-image glyph.
- Pinned Work tab: existing pin ring unchanged.

- [ ] **Step 3: Report results**

State what was checked and what was observed; screenshots if driving via cmux.
