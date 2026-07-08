# Page Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native right-click context menus inside web page views: link items (open, open in background tab, bookmark, copy URL), image items (copy, copy URL, download), Cut/Copy/Paste for selections and editable fields, and Back/Forward/Reload as a fallback.

**Architecture:** Mirrors the repo's tab-model/tab-manager split. `src/main/page-context-menu.ts` is a pure, Electron-free builder that maps context params to a declarative item list (fully Vitest-covered). `src/main/page-context-menu-host.ts` wires `wc.on('context-menu')` to that builder and pops a native `Menu`. `index.ts` attaches the host to every page view via the existing `onTabCreated` callback.

**Tech Stack:** Electron (main process only — page tabs stay sandboxed with no preload), TypeScript strict, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-08-page-context-menu-design.md`

## Global Constraints

- TypeScript strict; no runtime npm dependencies may be added.
- Pure logic must be Electron-free and Vitest-covered; Electron-coupled code is verified by manual smoke (README convention).
- Link section only for URLs matching `^https?://`.
- "Open in a New Tab" opens in the background and inherits the source tab's profile.
- Exact labels: "Open Link", "Open in a New Tab", "Bookmark Link", "Copy Link URL", "Copy Image", "Copy Image URL", "Download Image", "Cut", "Copy", "Paste", "Back", "Forward", "Reload".
- Short conventional commits (`feat:`, `fix:`, `chore:`).
- Tests live in `tests/` at repo root and import from `../src/...`.
- Run `npm test` and `npm run typecheck` before every commit.

---

### Task 1: Builder module — link section + bookmark title helper

**Files:**
- Create: `src/main/page-context-menu.ts`
- Create: `tests/page-context-menu.test.ts`

**Interfaces:**
- Consumes: nothing (new leaf module).
- Produces (later tasks extend/use these exact shapes):
  - `type PageMenuAction = 'open-link' | 'open-link-new-tab' | 'bookmark-link' | 'copy-link-url' | 'copy-image' | 'copy-image-url' | 'download-image' | 'cut' | 'copy' | 'paste' | 'back' | 'forward' | 'reload'`
  - `type PageMenuItem = { kind: 'separator' } | { kind: 'item'; label: string; action: PageMenuAction; enabled: boolean }`
  - `interface PageContextParams { linkURL: string; linkText: string; mediaType: string; srcURL: string; selectionText: string; isEditable: boolean; editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean } }`
  - `interface PageTabContext { canGoBack: boolean; canGoForward: boolean }`
  - `buildPageContextMenu(params: PageContextParams, ctx: PageTabContext): PageMenuItem[]`
  - `linkBookmarkTitle(params: PageContextParams): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/page-context-menu.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildPageContextMenu,
  linkBookmarkTitle,
  type PageContextParams,
  type PageMenuItem,
} from '../src/main/page-context-menu'

// every field at its "nothing under the cursor" default; tests override what they need
function params(overrides: Partial<PageContextParams> = {}): PageContextParams {
  return {
    linkURL: '',
    linkText: '',
    mediaType: 'none',
    srcURL: '',
    selectionText: '',
    isEditable: false,
    editFlags: { canCut: false, canCopy: false, canPaste: false },
    ...overrides,
  }
}

const ctx = { canGoBack: false, canGoForward: false }

function labels(items: PageMenuItem[]): string[] {
  return items.map((i) => (i.kind === 'separator' ? '---' : i.label))
}

function actions(items: PageMenuItem[]): string[] {
  return items.flatMap((i) => (i.kind === 'item' ? [i.action] : []))
}

describe('link section', () => {
  it('shows the five link items for an http(s) link', () => {
    const items = buildPageContextMenu(params({ linkURL: 'https://example.com/a' }), ctx)
    expect(labels(items)).toEqual([
      'Open Link',
      'Open in a New Tab',
      '---',
      'Bookmark Link',
      'Copy Link URL',
    ])
  })

  it('maps link items to link actions', () => {
    const items = buildPageContextMenu(params({ linkURL: 'http://example.com/a' }), ctx)
    expect(actions(items)).toEqual([
      'open-link',
      'open-link-new-tab',
      'bookmark-link',
      'copy-link-url',
    ])
  })

  it('shows no link section for non-http(s) links', () => {
    for (const linkURL of ['mailto:x@example.com', 'javascript:void(0)', 'ftp://files.example']) {
      const items = buildPageContextMenu(params({ linkURL }), ctx)
      expect(labels(items)).not.toContain('Open Link')
    }
  })
})

describe('linkBookmarkTitle', () => {
  it('uses the trimmed link text', () => {
    const p = params({ linkURL: 'https://a.example', linkText: '  Cool Site  ' })
    expect(linkBookmarkTitle(p)).toBe('Cool Site')
  })

  it('falls back to the url when the text is blank', () => {
    const p = params({ linkURL: 'https://a.example', linkText: '  ' })
    expect(linkBookmarkTitle(p)).toBe('https://a.example')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/main/page-context-menu`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/main/page-context-menu.ts`:

```ts
// Electron-free menu logic for right-clicks inside web page views.
// Mirrors the tab-model/tab-manager split: pure decisions here, Electron
// wiring (Menu.popup, clipboard, webContents calls) in page-context-menu-host.ts.

export type PageMenuAction =
  | 'open-link'
  | 'open-link-new-tab'
  | 'bookmark-link'
  | 'copy-link-url'
  | 'copy-image'
  | 'copy-image-url'
  | 'download-image'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'back'
  | 'forward'
  | 'reload'

export type PageMenuItem =
  | { kind: 'separator' }
  | { kind: 'item'; label: string; action: PageMenuAction; enabled: boolean }

// structural subset of Electron.ContextMenuParams, so the host can pass the
// event params straight through without copying
export interface PageContextParams {
  linkURL: string
  linkText: string
  mediaType: string
  srcURL: string
  selectionText: string
  isEditable: boolean
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean }
}

export interface PageTabContext {
  canGoBack: boolean
  canGoForward: boolean
}

const HTTP_RE = /^https?:\/\//

function item(label: string, action: PageMenuAction, enabled = true): PageMenuItem {
  return { kind: 'item', label, action, enabled }
}

export function linkBookmarkTitle(params: PageContextParams): string {
  return params.linkText.trim() || params.linkURL
}

export function buildPageContextMenu(
  params: PageContextParams,
  ctx: PageTabContext,
): PageMenuItem[] {
  const sections: PageMenuItem[][] = []
  if (HTTP_RE.test(params.linkURL)) {
    sections.push([
      item('Open Link', 'open-link'),
      item('Open in a New Tab', 'open-link-new-tab'),
      { kind: 'separator' },
      item('Bookmark Link', 'bookmark-link'),
      item('Copy Link URL', 'copy-link-url'),
    ])
  }
  return sections.flatMap((s, i) =>
    i === 0 ? s : [{ kind: 'separator' } as PageMenuItem, ...s],
  )
}
```

Note: `ctx` is unused until Task 4; TypeScript does not flag unused function parameters under this repo's config, and the signature must be final now because the test file and later tasks depend on it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all files, including the new `tests/page-context-menu.test.ts`).

Run: `npm run typecheck`
Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add src/main/page-context-menu.ts tests/page-context-menu.test.ts
git commit -m "feat: page context menu builder — link section"
```

---

### Task 2: Builder — image section (incl. linked images)

**Files:**
- Modify: `src/main/page-context-menu.ts` (extend `buildPageContextMenu`)
- Test: `tests/page-context-menu.test.ts`

**Interfaces:**
- Consumes: Task 1's types and `item()` helper, unchanged.
- Produces: image items `copy-image` / `copy-image-url` / `download-image` appear when `mediaType === 'image'` and `srcURL` is non-empty; sections are joined by single separators.

- [ ] **Step 1: Write the failing tests**

Append to `tests/page-context-menu.test.ts`:

```ts
describe('image section', () => {
  it('shows copy / copy url / download for an image', () => {
    const items = buildPageContextMenu(
      params({ mediaType: 'image', srcURL: 'https://example.com/cat.png' }),
      ctx,
    )
    expect(labels(items)).toEqual(['Copy Image', 'Copy Image URL', 'Download Image'])
    expect(actions(items)).toEqual(['copy-image', 'copy-image-url', 'download-image'])
  })

  it('shows the link section above the image section for a linked image', () => {
    const items = buildPageContextMenu(
      params({
        linkURL: 'https://example.com/a',
        mediaType: 'image',
        srcURL: 'https://example.com/cat.png',
      }),
      ctx,
    )
    expect(labels(items)).toEqual([
      'Open Link',
      'Open in a New Tab',
      '---',
      'Bookmark Link',
      'Copy Link URL',
      '---',
      'Copy Image',
      'Copy Image URL',
      'Download Image',
    ])
  })

  it('shows no image section when the image has no src url', () => {
    const items = buildPageContextMenu(params({ mediaType: 'image' }), ctx)
    expect(labels(items)).not.toContain('Copy Image')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — the two positive image tests get `[]` instead of image items.

- [ ] **Step 3: Implement**

In `src/main/page-context-menu.ts`, insert after the link-section `if` block (before the `return`):

```ts
  if (params.mediaType === 'image' && params.srcURL) {
    sections.push([
      item('Copy Image', 'copy-image'),
      item('Copy Image URL', 'copy-image-url'),
      item('Download Image', 'download-image'),
    ])
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/page-context-menu.ts tests/page-context-menu.test.ts
git commit -m "feat: page context menu builder — image section"
```

---

### Task 3: Builder — edit/selection section

**Files:**
- Modify: `src/main/page-context-menu.ts` (extend `buildPageContextMenu`)
- Test: `tests/page-context-menu.test.ts`

**Interfaces:**
- Consumes: Task 1's types and `item()` helper, unchanged.
- Produces: editable fields get Cut/Copy/Paste enabled per `editFlags`; non-editable selections get Copy only.

- [ ] **Step 1: Write the failing tests**

Append to `tests/page-context-menu.test.ts`:

```ts
describe('edit and selection section', () => {
  it('shows Copy for a text selection', () => {
    const items = buildPageContextMenu(
      params({
        selectionText: 'hello',
        editFlags: { canCut: false, canCopy: true, canPaste: false },
      }),
      ctx,
    )
    expect(items).toEqual([{ kind: 'item', label: 'Copy', action: 'copy', enabled: true }])
  })

  it('shows no Copy for a whitespace-only selection', () => {
    const items = buildPageContextMenu(params({ selectionText: '   ' }), ctx)
    expect(labels(items)).not.toContain('Copy')
  })

  it('shows Cut/Copy/Paste in editable fields, enabled per editFlags', () => {
    const items = buildPageContextMenu(
      params({
        isEditable: true,
        editFlags: { canCut: false, canCopy: false, canPaste: true },
      }),
      ctx,
    )
    expect(items).toEqual([
      { kind: 'item', label: 'Cut', action: 'cut', enabled: false },
      { kind: 'item', label: 'Copy', action: 'copy', enabled: false },
      { kind: 'item', label: 'Paste', action: 'paste', enabled: true },
    ])
  })

  it('separates selection Copy from a link section', () => {
    const items = buildPageContextMenu(
      params({
        linkURL: 'https://example.com/a',
        selectionText: 'hello',
        editFlags: { canCut: false, canCopy: true, canPaste: false },
      }),
      ctx,
    )
    expect(labels(items)).toEqual([
      'Open Link',
      'Open in a New Tab',
      '---',
      'Bookmark Link',
      'Copy Link URL',
      '---',
      'Copy',
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — the three positive tests get no Cut/Copy/Paste items.

- [ ] **Step 3: Implement**

In `src/main/page-context-menu.ts`, insert after the image-section `if` block (before the `return`):

```ts
  if (params.isEditable) {
    sections.push([
      item('Cut', 'cut', params.editFlags.canCut),
      item('Copy', 'copy', params.editFlags.canCopy),
      item('Paste', 'paste', params.editFlags.canPaste),
    ])
  } else if (params.selectionText.trim()) {
    sections.push([item('Copy', 'copy', params.editFlags.canCopy)])
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/page-context-menu.ts tests/page-context-menu.test.ts
git commit -m "feat: page context menu builder — edit/selection section"
```

---

### Task 4: Builder — page fallback section

**Files:**
- Modify: `src/main/page-context-menu.ts` (extend `buildPageContextMenu`)
- Test: `tests/page-context-menu.test.ts`

**Interfaces:**
- Consumes: Task 1's types, `item()` helper, and — for the first time — the `ctx: PageTabContext` parameter.
- Produces: Back/Forward/Reload appear only when no other section rendered; Back/Forward enabled per `ctx`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/page-context-menu.test.ts`:

```ts
describe('page fallback section', () => {
  it('shows Back/Forward/Reload when nothing else applies', () => {
    const items = buildPageContextMenu(params(), { canGoBack: true, canGoForward: false })
    expect(items).toEqual([
      { kind: 'item', label: 'Back', action: 'back', enabled: true },
      { kind: 'item', label: 'Forward', action: 'forward', enabled: false },
      { kind: 'item', label: 'Reload', action: 'reload', enabled: true },
    ])
  })

  it('does not appear when any other section rendered', () => {
    const items = buildPageContextMenu(params({ linkURL: 'https://example.com/a' }), {
      canGoBack: true,
      canGoForward: true,
    })
    expect(labels(items)).not.toContain('Back')
    expect(labels(items)).not.toContain('Reload')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — the first fallback test gets `[]`.

- [ ] **Step 3: Implement**

In `src/main/page-context-menu.ts`, insert after the edit/selection block (before the `return`):

```ts
  if (sections.length === 0) {
    sections.push([
      item('Back', 'back', ctx.canGoBack),
      item('Forward', 'forward', ctx.canGoForward),
      item('Reload', 'reload'),
    ])
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all page-context-menu tests plus the whole existing suite.

Run: `npm run typecheck`
Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add src/main/page-context-menu.ts tests/page-context-menu.test.ts
git commit -m "feat: page context menu builder — page fallback section"
```

---

### Task 5: Host wrapper, wiring, and smoke verification

**Files:**
- Create: `src/main/page-context-menu-host.ts`
- Modify: `src/main/index.ts:129-132` (the `onTabCreated` callback) and its import block
- Modify: `README.md` (add a smoke checklist section after the extension one, `README.md:66-75`)

**Interfaces:**
- Consumes: `buildPageContextMenu`, `linkBookmarkTitle`, `PageMenuAction` from Task 1-4; `TabManager.createTab(url?, activate?, profile?)`; `BookmarksStore.add(url, title, createdAt, profile)`; `bookmarksChanged()` in `index.ts`.
- Produces: `attachPageContextMenu(wc: WebContents, win: BrowserWindow, actions: PageMenuActions): void` where `interface PageMenuActions { openLinkInNewTab(url: string): void; bookmarkLink(url: string, title: string): void }`.

There are no unit tests for this task — it is Electron-coupled, which this repo verifies by manual smoke (README convention). The builder logic it delegates to is covered by Tasks 1-4.

- [ ] **Step 1: Create the host wrapper**

Create `src/main/page-context-menu-host.ts`:

```ts
import { clipboard, Menu } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { buildPageContextMenu, linkBookmarkTitle } from './page-context-menu'
import type { PageMenuAction } from './page-context-menu'

export interface PageMenuActions {
  openLinkInNewTab(url: string): void
  bookmarkLink(url: string, title: string): void
}

// pops the native right-click menu for a web page view; menu structure is
// decided by the Electron-free builder in page-context-menu.ts
export function attachPageContextMenu(
  wc: WebContents,
  win: BrowserWindow,
  actions: PageMenuActions,
): void {
  wc.on('context-menu', (_e, p) => {
    const items = buildPageContextMenu(p, {
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    })
    const run: Record<PageMenuAction, () => void> = {
      'open-link': () => wc.loadURL(p.linkURL),
      'open-link-new-tab': () => actions.openLinkInNewTab(p.linkURL),
      'bookmark-link': () => actions.bookmarkLink(p.linkURL, linkBookmarkTitle(p)),
      'copy-link-url': () => clipboard.writeText(p.linkURL),
      'copy-image': () => wc.copyImageAt(p.x, p.y),
      'copy-image-url': () => clipboard.writeText(p.srcURL),
      'download-image': () => wc.downloadURL(p.srcURL),
      cut: () => wc.cut(),
      copy: () => wc.copy(),
      paste: () => wc.paste(),
      back: () => wc.navigationHistory.goBack(),
      forward: () => wc.navigationHistory.goForward(),
      reload: () => wc.reload(),
    }
    Menu.buildFromTemplate(
      items.map((it) =>
        it.kind === 'separator'
          ? { type: 'separator' as const }
          : { label: it.label, enabled: it.enabled, click: run[it.action] },
      ),
    ).popup({ window: win })
  })
}
```

- [ ] **Step 2: Wire it in index.ts**

In `src/main/index.ts`, add to the import block:

```ts
import { attachPageContextMenu } from './page-context-menu-host'
```

Then replace the existing `onTabCreated` callback:

```ts
    onTabCreated: (wc, profile) => {
      attachCycleHooks(wc)
      if (profile === 'default') extensions.addTab(wc)
    },
```

with:

```ts
    onTabCreated: (wc, profile) => {
      attachCycleHooks(wc)
      // `bookmarksChanged` is declared below; safe for the same reason as
      // `extensions` — no tab exists until startup wiring completes
      attachPageContextMenu(wc, win, {
        openLinkInNewTab: (url) => tabs.createTab(url, false, profile),
        bookmarkLink: (url, title) => {
          bookmarks.add(url, title, Date.now(), profile)
          bookmarksChanged()
        },
      })
      if (profile === 'default') extensions.addTab(wc)
    },
```

Note the surrounding comment above `onTabCreated` (about `extensions` being declared below) stays as is. A profile switch recreates the view and re-runs `onTabCreated` with the new profile, so the captured `profile` is always the view's actual container.

- [ ] **Step 3: Typecheck and run the full suite**

Run: `npm run typecheck`
Expected: clean exit. (`buildPageContextMenu(p, …)` accepts Electron's `ContextMenuParams` because `PageContextParams` is a structural subset of it.)

Run: `npm test`
Expected: PASS — entire suite.

- [ ] **Step 4: Add the smoke checklist to README**

In `README.md`, after the "Extension smoke checklist" section (after line 75), add:

```markdown
### Page context menu smoke checklist

1. Right-click a link → Open Link navigates the same tab.
2. Right-click a link → Open in a New Tab: tab appears in the sidebar, focus stays put;
   from a Work tab the new tab is also Work.
3. Right-click a link → Bookmark Link: bookmark appears (asleep) in the sidebar with the
   link's text as its title.
4. Right-click a link → Copy Link URL: URL is on the clipboard.
5. Right-click an image → Copy Image (paste somewhere), Copy Image URL, Download Image
   (lands in the downloads UI).
6. Right-click selected text → Copy. Right-click a text input → Cut/Copy/Paste with
   correct enablement.
7. Right-click empty page area → Back/Forward/Reload, enabled to match history.
8. `mailto:` link → no link items (fallback section only).
```

- [ ] **Step 5: Manual smoke**

Run the app: `npm run dev` (run in background).

Notes for the executor:
- The dev command buffers output when proxied; if you need boot logs, use `ELECTRON_ENABLE_LOGGING=1 rtk proxy npm run dev` with output redirected to a file.
- electron-vite dev does NOT hot-reload main-process code. If the dev server was already running before this task, restart it or the new main-process code will not execute.
- If the chrome UI comes up white with a preload error, force-quit duplicate Synapse instances first.

Walk the new README checklist above (items 1-8). All must behave as described.

- [ ] **Step 6: Commit**

```bash
git add src/main/page-context-menu-host.ts src/main/index.ts README.md
git commit -m "feat: show native context menu in web page views"
```

---

## Deviations from spec

The spec describes one module with two parts. The plan splits it into two files (`page-context-menu.ts` pure, `page-context-menu-host.ts` Electron) because Vitest cannot import a file that imports `electron`, and this mirrors the existing tab-model/tab-manager convention. Everything else is implemented exactly as specified.
