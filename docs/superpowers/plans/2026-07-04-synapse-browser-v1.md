# Synapse Browser v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A simple Chromium browser (Electron) with vertical tabs, URL bar with history suggestions, MRU + appearance-order tab cycling, downloads, history, and bookmarks.

**Architecture:** Main process owns all tab state: a pure `TabModel` state machine wrapped by `TabManager`, which binds it to `WebContentsView`s attached to a single `BrowserWindow`. The window's own renderer draws the chrome UI (vertical tab sidebar + top bar) and is a pure function of `tabs:updated` snapshots pushed over IPC. Persistence is debounced JSON in `userData`.

**Tech Stack:** Electron (current stable), TypeScript (strict), electron-vite (dev/build), Vitest (unit tests). No runtime dependencies, no UI framework.

**Spec:** `docs/superpowers/specs/2026-07-04-synapse-browser-design.md` — read it before starting.

## Global Constraints

- macOS 14+, Node 20+. All commands run from repo root: `/Users/dep/Sites/synapse-browser`.
- TypeScript `strict: true`. Plain JavaScript semantics otherwise — no decorators, no experimental features.
- No runtime npm dependencies. Everything is a devDependency (Electron bundles the runtime).
- Tab `WebContentsView`s get **no preload** and webPreferences `{ sandbox: true, contextIsolation: true }`. Web pages must have zero access to app APIs.
- Chrome UI renderer: `contextIsolation: true`, `nodeIntegration: false`, single preload exposing `window.synapse` only.
- Layout constants: `SIDEBAR_WIDTH = 240`, `TOPBAR_HEIGHT = 52` (defined once in `src/main/tab-manager.ts`).
- Search fallback is DuckDuckGo: `https://duckduckgo.com/?q=<encoded>`.
- History capped at 5,000 entries; JSON stores debounce writes at 500ms; corrupt store files are renamed `<name>.bad` and recreated, never crash.
- History/bookmarks JSON lives in `app.getPath('userData')` with a `v: 1` schema field.
- Commit after every task with a short conventional message (`feat:`, `chore:`, `test:`). Do not push.

---

### Task 1: Project scaffold

Electron + electron-vite + TypeScript + Vitest skeleton that opens a window showing a static chrome shell.

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `.gitignore`
- Create: `src/main/index.ts`, `src/preload/index.ts`
- Create: `src/renderer/index.html`, `src/renderer/main.ts`, `src/renderer/style.css`

**Interfaces:**
- Produces: `npm run dev` (run app), `npm test` (vitest), `npm run typecheck` (tsc). Directory layout `src/{main,preload,renderer}` per electron-vite convention.

- [ ] **Step 1: Write config files**

`package.json`:

```json
{
  "name": "synapse-browser",
  "version": "0.1.0",
  "private": true,
  "description": "A very simple Chromium browser",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

`electron.vite.config.ts`:

```ts
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {},
})
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "tests"]
}
```

`.gitignore`:

```
node_modules/
out/
dist/
*.log
.DS_Store
```

- [ ] **Step 2: Install dev dependencies**

Run: `npm install -D electron electron-vite vite typescript vitest @types/node`

Expected: completes without error; `package.json` gains `devDependencies`.

- [ ] **Step 3: Write the app skeleton**

`src/main/index.ts`:

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 700,
    minHeight: 400,
    title: 'Synapse Browser',
    webPreferences: { preload: join(__dirname, '../preload/index.js') },
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
})

app.on('window-all-closed', () => app.quit())
```

`src/preload/index.ts`:

```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('synapse', {})
```

`src/renderer/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src https: http: data:"
    />
    <title>Synapse Browser</title>
  </head>
  <body>
    <div id="app">
      <header id="topbar">
        <button id="nav-back" title="Back" disabled>←</button>
        <button id="nav-forward" title="Forward" disabled>→</button>
        <button id="nav-reload" title="Reload" disabled>⟳</button>
        <div id="urlbar-wrap">
          <input id="urlbar" type="text" placeholder="Search or enter address" spellcheck="false" />
          <div id="suggestions" hidden></div>
        </div>
        <button id="star" title="Bookmark this page">☆</button>
        <button id="download-pill" hidden></button>
      </header>
      <aside id="sidebar">
        <div id="tab-list"></div>
        <div id="panel" hidden></div>
        <div id="sidebar-footer">
          <button id="new-tab">＋ New Tab</button>
          <button id="show-history" title="History">🕘</button>
          <button id="show-bookmarks" title="Bookmarks">★</button>
        </div>
      </aside>
    </div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`src/renderer/main.ts`:

```ts
import './style.css'

console.log('Synapse chrome loaded')
```

`src/renderer/style.css`:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
:root {
  --bg: #1e1f24;
  --bg-raised: #2a2b31;
  --fg: #e6e6ea;
  --fg-dim: #9a9aa3;
  --accent: #7aa2f7;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 13px;
  color: var(--fg);
  background: var(--bg);
  user-select: none;
}
#app {
  display: grid;
  grid-template-rows: 52px 1fr;
  grid-template-columns: 240px 1fr;
  height: 100vh;
}
#topbar {
  grid-column: 1 / 3;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  background: var(--bg-raised);
}
#topbar button {
  background: none;
  border: none;
  color: var(--fg);
  font-size: 15px;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  cursor: pointer;
}
#topbar button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}
#topbar button:disabled {
  color: var(--fg-dim);
  opacity: 0.4;
}
#urlbar-wrap {
  flex: 1;
  position: relative;
}
#urlbar {
  width: 100%;
  height: 32px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--bg);
  color: var(--fg);
  outline: none;
}
#urlbar:focus {
  border-color: var(--accent);
}
#suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--bg-raised);
  border-radius: 8px;
  overflow: hidden;
}
#sidebar {
  grid-row: 2;
  grid-column: 1;
  display: flex;
  flex-direction: column;
  padding: 8px;
  overflow-y: auto;
}
#tab-list,
#panel {
  flex: 1;
  overflow-y: auto;
}
#sidebar-footer {
  display: flex;
  gap: 4px;
  padding-top: 8px;
}
#sidebar-footer button {
  background: none;
  border: none;
  color: var(--fg-dim);
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
#sidebar-footer button:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--fg);
}
#new-tab {
  flex: 1;
  text-align: left;
}
#download-pill {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  width: auto !important;
  padding: 0 10px;
}
```

- [ ] **Step 4: Verify the app runs**

Run: `npm run dev`

Expected: a window titled "Synapse Browser" opens showing a dark sidebar (＋ New Tab at bottom) and top bar with a URL input. Quit with Cmd+Q.

Run: `npm run typecheck`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron-vite + typescript + vitest project"
```

---

### Task 2: Shared types + URL classifier

**Files:**
- Create: `src/shared/ipc.ts`, `src/shared/url-classifier.ts`, `src/renderer/global.d.ts`
- Test: `tests/url-classifier.test.ts`

**Interfaces:**
- Produces: `classifyInput(raw: string): string`; all shared types (`TabInfo`, `TabsSnapshot`, `HistoryEntry`, `Bookmark`, `DownloadInfo`, `SynapseApi`); `window.synapse: SynapseApi` global typing for the renderer.

- [ ] **Step 1: Write shared types**

`src/shared/ipc.ts`:

```ts
export interface TabInfo {
  id: string
  title: string
  url: string
  favicon: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isBookmarked: boolean
}

export interface TabsSnapshot {
  tabs: Record<string, TabInfo>
  order: string[]
  activeId: string | null
}

export interface HistoryEntry {
  url: string
  title: string
  visitedAt: number
}

export interface Bookmark {
  url: string
  title: string
  createdAt: number
}

export interface DownloadInfo {
  id: string
  filename: string
  state: 'progressing' | 'completed' | 'failed'
  receivedBytes: number
  totalBytes: number
}

export interface SynapseApi {
  tabs: {
    create(url?: string): void
    close(id: string): void
    activate(id: string): void
    navigate(id: string, input: string): void
    back(id: string): void
    forward(id: string): void
    reload(id: string): void
  }
  onTabsUpdated(cb: (snap: TabsSnapshot) => void): void
  history: {
    search(q: string): Promise<HistoryEntry[]>
    list(): Promise<HistoryEntry[]>
  }
  bookmarks: {
    toggleActive(): Promise<void>
    list(): Promise<Bookmark[]>
  }
  downloads: {
    reveal(id: string): void
    onUpdated(cb: (list: DownloadInfo[]) => void): void
  }
  ui: {
    setOverlayHeight(px: number): void
    onFocusUrlBar(cb: () => void): void
    onToggleHistory(cb: () => void): void
    onToggleBookmarks(cb: () => void): void
  }
}
```

`src/renderer/global.d.ts`:

```ts
import type { SynapseApi } from '../shared/ipc'

declare global {
  interface Window {
    synapse: SynapseApi
  }
}

export {}
```

- [ ] **Step 2: Write the failing test**

`tests/url-classifier.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { classifyInput } from '../src/shared/url-classifier'

describe('classifyInput', () => {
  it('passes through full URLs', () => {
    expect(classifyInput('https://example.com/a?b=c')).toBe('https://example.com/a?b=c')
    expect(classifyInput('http://example.com')).toBe('http://example.com')
    expect(classifyInput('file:///Users/dep/x.html')).toBe('file:///Users/dep/x.html')
    expect(classifyInput('about:blank')).toBe('about:blank')
  })

  it('prefixes https:// onto host-like input', () => {
    expect(classifyInput('example.com')).toBe('https://example.com')
    expect(classifyInput('news.ycombinator.com/item?id=1')).toBe('https://news.ycombinator.com/item?id=1')
    expect(classifyInput('example.com:8080/path')).toBe('https://example.com:8080/path')
  })

  it('uses http:// for localhost and loopback', () => {
    expect(classifyInput('localhost:3000')).toBe('http://localhost:3000')
    expect(classifyInput('127.0.0.1:8000/admin')).toBe('http://127.0.0.1:8000/admin')
  })

  it('sends everything else to DuckDuckGo', () => {
    expect(classifyInput('what is rust')).toBe('https://duckduckgo.com/?q=what%20is%20rust')
    expect(classifyInput('hello')).toBe('https://duckduckgo.com/?q=hello')
    expect(classifyInput('is example.com down')).toBe('https://duckduckgo.com/?q=is%20example.com%20down')
  })

  it('trims whitespace and treats empty as about:blank', () => {
    expect(classifyInput('  example.com  ')).toBe('https://example.com')
    expect(classifyInput('')).toBe('about:blank')
    expect(classifyInput('   ')).toBe('about:blank')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`

Expected: FAIL — cannot find module `../src/shared/url-classifier`.

- [ ] **Step 4: Write the implementation**

`src/shared/url-classifier.ts`:

```ts
const FULL_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i
const HOST_RE = /^(localhost|\d{1,3}(\.\d{1,3}){3}|[\w-]+(\.[a-z0-9-]+)+)(:\d+)?(\/\S*)?$/i

export function classifyInput(raw: string): string {
  const input = raw.trim()
  if (!input) return 'about:blank'
  if (FULL_URL_RE.test(input) || input.startsWith('about:')) return input
  if (!input.includes(' ') && HOST_RE.test(input)) {
    const host = input.split(/[/:]/)[0].toLowerCase()
    const scheme = host === 'localhost' || host === '127.0.0.1' ? 'http' : 'https'
    return `${scheme}://${input}`
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(input)}`
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`

Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared tests src/renderer/global.d.ts
git commit -m "feat: shared IPC types and URL input classifier"
```

---

### Task 3: History fuzzy search

**Files:**
- Create: `src/shared/history-search.ts`
- Test: `tests/history-search.test.ts`

**Interfaces:**
- Consumes: `HistoryEntry` from `src/shared/ipc.ts`.
- Produces: `searchHistory(entries: HistoryEntry[], query: string, limit?: number): HistoryEntry[]` — entries must be most-recent-first; result is deduped by URL, substring matches rank above subsequence matches, recency breaks ties, default limit 5.

- [ ] **Step 1: Write the failing test**

`tests/history-search.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { searchHistory } from '../src/shared/history-search'
import type { HistoryEntry } from '../src/shared/ipc'

const e = (url: string, title: string): HistoryEntry => ({ url, title, visitedAt: 0 })

describe('searchHistory', () => {
  it('matches substrings in title or url', () => {
    const entries = [e('https://a.com', 'Alpha Site'), e('https://b.com/rust-book', 'Learn')]
    expect(searchHistory(entries, 'alpha').map((x) => x.url)).toEqual(['https://a.com'])
    expect(searchHistory(entries, 'rust').map((x) => x.url)).toEqual(['https://b.com/rust-book'])
  })

  it('ranks substring matches above subsequence matches', () => {
    const entries = [
      e('https://sub-sequence.com', 'x grep y'), // 'gp' only as subsequence
      e('https://gp.com', 'GP direct'), // 'gp' substring
    ]
    expect(searchHistory(entries, 'gp').map((x) => x.url)).toEqual([
      'https://gp.com',
      'https://sub-sequence.com',
    ])
  })

  it('excludes non-matches', () => {
    const entries = [e('https://a.com', 'Alpha')]
    expect(searchHistory(entries, 'zzz')).toEqual([])
  })

  it('dedupes by url keeping the most recent entry', () => {
    const entries = [e('https://a.com', 'Newest'), e('https://a.com', 'Older')]
    const results = searchHistory(entries, 'a.com')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Newest')
  })

  it('limits results to 5 by default, preserving recency order', () => {
    const entries = Array.from({ length: 10 }, (_, i) => e(`https://site${i}.com`, `Site ${i}`))
    const results = searchHistory(entries, 'site')
    expect(results).toHaveLength(5)
    expect(results[0].url).toBe('https://site0.com')
  })

  it('returns [] for empty query', () => {
    expect(searchHistory([e('https://a.com', 'A')], '')).toEqual([])
    expect(searchHistory([e('https://a.com', 'A')], '  ')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL — cannot find module `../src/shared/history-search`.

- [ ] **Step 3: Write the implementation**

`src/shared/history-search.ts`:

```ts
import type { HistoryEntry } from './ipc'

export function searchHistory(entries: HistoryEntry[], query: string, limit = 5): HistoryEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const seen = new Set<string>()
  const scored: { entry: HistoryEntry; score: number }[] = []
  for (const entry of entries) {
    if (seen.has(entry.url)) continue
    seen.add(entry.url)
    const hay = `${entry.title} ${entry.url}`.toLowerCase()
    let score = 0
    if (hay.includes(q)) score = 2
    else if (isSubsequence(q, hay)) score = 1
    if (score > 0) scored.push({ entry, score })
  }
  // Array.prototype.sort is stable: within a score, recency order is preserved.
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.entry)
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0
  for (const ch of hay) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return needle.length === 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add src/shared/history-search.ts tests/history-search.test.ts
git commit -m "feat: history fuzzy search with substring/subsequence ranking"
```

---

### Task 4: TabModel state machine

Pure, Electron-free tab state: sidebar order, MRU order, active tab, and hold-and-walk cycling.

**Files:**
- Create: `src/main/tab-model.ts`
- Test: `tests/tab-model.test.ts`

**Interfaces:**
- Produces:
  - `type CycleList = 'mru' | 'order'`, `type Direction = 'forward' | 'back'`
  - `class TabModel` with fields `order: string[]`, `mru: string[]`, `activeId: string | null` and methods `add(id, activate?)`, `activate(id)`, `close(id)`, `cycleStep(list, dir): string | null`, `cycleCommit()`, `isCycling(): boolean`.
- Semantics: `cycleStep` moves `activeId` through the chosen list (wrapping) **without** reordering MRU; `cycleCommit` promotes the previewed tab to MRU front; `activate` promotes and cancels any cycle; `close` commits any in-flight cycle first, and if the active tab closed, the MRU front becomes active.

- [ ] **Step 1: Write the failing test**

`tests/tab-model.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { TabModel } from '../src/main/tab-model'

describe('TabModel', () => {
  let m: TabModel

  beforeEach(() => {
    m = new TabModel()
    m.add('a')
    m.add('b')
    m.add('c') // activation order a, b, c → mru [c, b, a]
  })

  it('activates each added tab by default', () => {
    expect(m.order).toEqual(['a', 'b', 'c'])
    expect(m.mru).toEqual(['c', 'b', 'a'])
    expect(m.activeId).toBe('c')
  })

  it('adds background tabs at the MRU tail without activating', () => {
    m.add('d', false)
    expect(m.activeId).toBe('c')
    expect(m.mru).toEqual(['c', 'b', 'a', 'd'])
  })

  it('activate promotes in MRU', () => {
    m.activate('a')
    expect(m.activeId).toBe('a')
    expect(m.mru).toEqual(['a', 'c', 'b'])
  })

  it('closing the active tab activates the MRU front', () => {
    m.close('c')
    expect(m.order).toEqual(['a', 'b'])
    expect(m.activeId).toBe('b')
  })

  it('closing a background tab keeps the active tab', () => {
    m.close('a')
    expect(m.activeId).toBe('c')
    expect(m.mru).toEqual(['c', 'b'])
  })

  it('closing the last tab leaves an empty model', () => {
    m.close('a')
    m.close('b')
    m.close('c')
    expect(m.order).toEqual([])
    expect(m.activeId).toBeNull()
  })

  it('quick MRU toggle: step + commit swaps the two most recent tabs', () => {
    expect(m.cycleStep('mru', 'forward')).toBe('b')
    m.cycleCommit()
    expect(m.mru).toEqual(['b', 'c', 'a'])
    expect(m.cycleStep('mru', 'forward')).toBe('c')
    m.cycleCommit()
    expect(m.mru).toEqual(['c', 'b', 'a'])
  })

  it('holding: repeated MRU steps walk deeper without reordering until commit', () => {
    m.cycleStep('mru', 'forward') // preview b
    expect(m.cycleStep('mru', 'forward')).toBe('a') // deeper
    expect(m.mru).toEqual(['c', 'b', 'a']) // unchanged during walk
    m.cycleCommit()
    expect(m.mru).toEqual(['a', 'c', 'b'])
    expect(m.isCycling()).toBe(false)
  })

  it('MRU back steps walk the other way and wrap', () => {
    expect(m.cycleStep('mru', 'back')).toBe('a') // wrap from index 0
  })

  it('order cycling follows sidebar order and wraps', () => {
    expect(m.cycleStep('order', 'forward')).toBe('a') // c wraps to a
    expect(m.cycleStep('order', 'back')).toBe('c')
    expect(m.cycleStep('order', 'back')).toBe('b')
  })

  it('explicit activate cancels an in-flight cycle', () => {
    m.cycleStep('mru', 'forward')
    m.activate('a')
    expect(m.isCycling()).toBe(false)
    m.cycleCommit() // must be a no-op
    expect(m.mru).toEqual(['a', 'c', 'b'])
  })

  it('close during a cycle commits the preview first', () => {
    m.cycleStep('mru', 'forward') // preview b
    m.close('a')
    expect(m.isCycling()).toBe(false)
    expect(m.activeId).toBe('b')
    expect(m.mru).toEqual(['b', 'c'])
  })

  it('cycleStep is a no-op with fewer than two tabs', () => {
    const solo = new TabModel()
    solo.add('x')
    expect(solo.cycleStep('mru', 'forward')).toBeNull()
    expect(solo.activeId).toBe('x')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL — cannot find module `../src/main/tab-model`.

- [ ] **Step 3: Write the implementation**

`src/main/tab-model.ts`:

```ts
export type CycleList = 'mru' | 'order'
export type Direction = 'forward' | 'back'

export class TabModel {
  order: string[] = []
  mru: string[] = []
  activeId: string | null = null
  private cycling = false

  add(id: string, activate = true): void {
    this.order.push(id)
    if (activate) {
      this.mru.unshift(id)
      this.activeId = id
      this.cycling = false
    } else {
      this.mru.push(id)
    }
  }

  activate(id: string): void {
    if (!this.order.includes(id)) return
    this.promote(id)
    this.activeId = id
    this.cycling = false
  }

  close(id: string): void {
    if (!this.order.includes(id)) return
    if (this.cycling) this.cycleCommit()
    this.order = this.order.filter((t) => t !== id)
    this.mru = this.mru.filter((t) => t !== id)
    if (this.activeId === id) this.activeId = this.mru[0] ?? null
  }

  cycleStep(list: CycleList, dir: Direction): string | null {
    const ids = list === 'mru' ? this.mru : this.order
    if (ids.length < 2 || !this.activeId) return null
    const idx = ids.indexOf(this.activeId)
    const delta = dir === 'forward' ? 1 : -1
    const next = ids[(idx + delta + ids.length) % ids.length]
    this.activeId = next
    this.cycling = true
    return next
  }

  cycleCommit(): void {
    if (!this.cycling) return
    if (this.activeId) this.promote(this.activeId)
    this.cycling = false
  }

  isCycling(): boolean {
    return this.cycling
  }

  private promote(id: string): void {
    this.mru = this.mru.filter((t) => t !== id)
    this.mru.unshift(id)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add src/main/tab-model.ts tests/tab-model.test.ts
git commit -m "feat: TabModel state machine with MRU and order cycling"
```

---

### Task 5: JsonStore

Debounced JSON persistence with corrupt-file recovery.

**Files:**
- Create: `src/main/store.ts`
- Test: `tests/store.test.ts`

**Interfaces:**
- Produces: `class JsonStore<T>` — `constructor(filePath: string, fallback: T, debounceMs = 500)`, `get(): T`, `set(data: T): void` (schedules debounced write), `flush(): void` (writes immediately, creates parent dirs). Corrupt file on load → renamed to `<file>.bad`, fallback used.

- [ ] **Step 1: Write the failing test**

`tests/store.test.ts`:

```ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JsonStore } from '../src/main/store'

interface Data {
  v: 1
  items: string[]
}

const FALLBACK: Data = { v: 1, items: [] }

describe('JsonStore', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonstore-'))
    file = path.join(dir, 'data.json')
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns fallback when file is missing', () => {
    const store = new JsonStore<Data>(file, FALLBACK)
    expect(store.get()).toEqual(FALLBACK)
  })

  it('loads existing file contents', () => {
    fs.writeFileSync(file, JSON.stringify({ v: 1, items: ['x'] }))
    const store = new JsonStore<Data>(file, FALLBACK)
    expect(store.get().items).toEqual(['x'])
  })

  it('set() debounces the write', () => {
    const store = new JsonStore<Data>(file, FALLBACK, 500)
    store.set({ v: 1, items: ['a'] })
    expect(fs.existsSync(file)).toBe(false)
    vi.advanceTimersByTime(499)
    expect(fs.existsSync(file)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).items).toEqual(['a'])
  })

  it('coalesces rapid set() calls into one final write', () => {
    const store = new JsonStore<Data>(file, FALLBACK, 500)
    store.set({ v: 1, items: ['a'] })
    vi.advanceTimersByTime(400)
    store.set({ v: 1, items: ['a', 'b'] })
    vi.advanceTimersByTime(500)
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).items).toEqual(['a', 'b'])
  })

  it('flush() writes immediately and creates parent directories', () => {
    const nested = path.join(dir, 'deep', 'nested', 'data.json')
    const store = new JsonStore<Data>(nested, FALLBACK)
    store.set({ v: 1, items: ['now'] })
    store.flush()
    expect(JSON.parse(fs.readFileSync(nested, 'utf8')).items).toEqual(['now'])
  })

  it('renames a corrupt file to .bad and uses the fallback', () => {
    fs.writeFileSync(file, '{not json!!')
    const store = new JsonStore<Data>(file, FALLBACK)
    expect(store.get()).toEqual(FALLBACK)
    expect(fs.existsSync(`${file}.bad`)).toBe(true)
    expect(fs.existsSync(file)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL — cannot find module `../src/main/store`.

- [ ] **Step 3: Write the implementation**

`src/main/store.ts`:

```ts
import * as fs from 'node:fs'
import * as path from 'node:path'

export class JsonStore<T> {
  private data: T
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private filePath: string,
    fallback: T,
    private debounceMs = 500,
  ) {
    this.data = this.load(fallback)
  }

  get(): T {
    return this.data
  }

  set(data: T): void {
    this.data = data
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.debounceMs)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
  }

  private load(fallback: T): T {
    try {
      if (!fs.existsSync(this.filePath)) return fallback
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as T
    } catch {
      try {
        fs.renameSync(this.filePath, `${this.filePath}.bad`)
      } catch {
        // If even the rename fails, fall through to the fallback.
      }
      return fallback
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add src/main/store.ts tests/store.test.ts
git commit -m "feat: debounced JsonStore with corrupt-file recovery"
```

---

### Task 6: HistoryStore + BookmarksStore

**Files:**
- Create: `src/main/history.ts`, `src/main/bookmarks.ts`
- Test: `tests/history.test.ts`, `tests/bookmarks.test.ts`

**Interfaces:**
- Consumes: `JsonStore` (Task 5), `searchHistory` (Task 3), `HistoryEntry`/`Bookmark` types (Task 2).
- Produces:
  - `class HistoryStore` — `constructor(dir: string)`, `add(url, title, visitedAt)`, `search(query, limit?): HistoryEntry[]`, `list(limit = 100): HistoryEntry[]`, `flush()`. Files: `<dir>/history.json`.
  - `class BookmarksStore` — `constructor(dir: string)`, `isBookmarked(url): boolean`, `toggle(url, title, createdAt): boolean` (returns new bookmarked state), `list(): Bookmark[]`, `flush()`. Files: `<dir>/bookmarks.json`.

- [ ] **Step 1: Write the failing tests**

`tests/history.test.ts`:

```ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HistoryStore } from '../src/main/history'

describe('HistoryStore', () => {
  let dir: string
  let store: HistoryStore

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-'))
    store = new HistoryStore(dir)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('adds entries most-recent-first', () => {
    store.add('https://a.com', 'A', 1)
    store.add('https://b.com', 'B', 2)
    expect(store.list().map((e) => e.url)).toEqual(['https://b.com', 'https://a.com'])
  })

  it('ignores non-http(s) urls', () => {
    store.add('data:text/html,x', 'Error page', 1)
    store.add('about:blank', 'Blank', 2)
    expect(store.list()).toEqual([])
  })

  it('skips a consecutive duplicate of the newest entry', () => {
    store.add('https://a.com', 'A', 1)
    store.add('https://a.com', 'A again', 2)
    expect(store.list()).toHaveLength(1)
  })

  it('caps at 5000 entries', () => {
    for (let i = 0; i < 5001; i++) store.add(`https://site${i}.com`, `S${i}`, i)
    expect(store.list(6000)).toHaveLength(5000)
    expect(store.list(1)[0].url).toBe('https://site5000.com')
  })

  it('search finds matches', () => {
    store.add('https://rust-lang.org', 'Rust Programming Language', 1)
    expect(store.search('rust')).toHaveLength(1)
  })

  it('persists via flush and reloads', () => {
    store.add('https://a.com', 'A', 1)
    store.flush()
    const reloaded = new HistoryStore(dir)
    expect(reloaded.list()).toHaveLength(1)
  })
})
```

`tests/bookmarks.test.ts`:

```ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BookmarksStore } from '../src/main/bookmarks'

describe('BookmarksStore', () => {
  let dir: string
  let store: BookmarksStore

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-'))
    store = new BookmarksStore(dir)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('toggle adds a bookmark and returns true', () => {
    expect(store.toggle('https://a.com', 'A', 1)).toBe(true)
    expect(store.isBookmarked('https://a.com')).toBe(true)
    expect(store.list()).toHaveLength(1)
  })

  it('toggle removes an existing bookmark and returns false', () => {
    store.toggle('https://a.com', 'A', 1)
    expect(store.toggle('https://a.com', 'A', 2)).toBe(false)
    expect(store.isBookmarked('https://a.com')).toBe(false)
    expect(store.list()).toEqual([])
  })

  it('persists via flush and reloads', () => {
    store.toggle('https://a.com', 'A', 1)
    store.flush()
    const reloaded = new BookmarksStore(dir)
    expect(reloaded.isBookmarked('https://a.com')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`

Expected: FAIL — cannot find modules `../src/main/history` and `../src/main/bookmarks`.

- [ ] **Step 3: Write the implementations**

`src/main/history.ts`:

```ts
import * as path from 'node:path'
import { searchHistory } from '../shared/history-search'
import type { HistoryEntry } from '../shared/ipc'
import { JsonStore } from './store'

const MAX_ENTRIES = 5000

interface HistoryFile {
  v: 1
  entries: HistoryEntry[]
}

export class HistoryStore {
  private store: JsonStore<HistoryFile>

  constructor(dir: string) {
    this.store = new JsonStore<HistoryFile>(path.join(dir, 'history.json'), { v: 1, entries: [] })
  }

  add(url: string, title: string, visitedAt: number): void {
    if (!/^https?:\/\//.test(url)) return
    const { entries } = this.store.get()
    if (entries[0]?.url === url) return
    const next = [{ url, title, visitedAt }, ...entries].slice(0, MAX_ENTRIES)
    this.store.set({ v: 1, entries: next })
  }

  search(query: string, limit = 5): HistoryEntry[] {
    return searchHistory(this.store.get().entries, query, limit)
  }

  list(limit = 100): HistoryEntry[] {
    return this.store.get().entries.slice(0, limit)
  }

  flush(): void {
    this.store.flush()
  }
}
```

`src/main/bookmarks.ts`:

```ts
import * as path from 'node:path'
import type { Bookmark } from '../shared/ipc'
import { JsonStore } from './store'

interface BookmarksFile {
  v: 1
  bookmarks: Bookmark[]
}

export class BookmarksStore {
  private store: JsonStore<BookmarksFile>

  constructor(dir: string) {
    this.store = new JsonStore<BookmarksFile>(path.join(dir, 'bookmarks.json'), { v: 1, bookmarks: [] })
  }

  isBookmarked(url: string): boolean {
    return this.store.get().bookmarks.some((b) => b.url === url)
  }

  toggle(url: string, title: string, createdAt: number): boolean {
    const { bookmarks } = this.store.get()
    if (this.isBookmarked(url)) {
      this.store.set({ v: 1, bookmarks: bookmarks.filter((b) => b.url !== url) })
      return false
    }
    this.store.set({ v: 1, bookmarks: [{ url, title, createdAt }, ...bookmarks] })
    return true
  }

  list(): Bookmark[] {
    return this.store.get().bookmarks
  }

  flush(): void {
    this.store.flush()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add src/main/history.ts src/main/bookmarks.ts tests/history.test.ts tests/bookmarks.test.ts
git commit -m "feat: history and bookmarks stores"
```

---

### Task 7: TabManager + preload + IPC wiring

Real Chromium tabs. After this task the app opens with one tab showing a live page; the chrome UI is still inert (Task 8 wires it).

**Files:**
- Create: `src/main/tab-manager.ts`
- Modify: `src/main/index.ts` (full rewrite), `src/preload/index.ts` (full rewrite)

**Interfaces:**
- Consumes: `TabModel` (Task 4), `classifyInput` (Task 2), `HistoryStore`/`BookmarksStore` (Task 6), shared types (Task 2).
- Produces:
  - `class TabManager` — `constructor(win: BrowserWindow, opts: TabManagerOptions)`, `createTab(url?: string, activate = true): string`, `closeTab(id)`, `activateTab(id)`, `navigate(id, input)`, `back(id)`, `forward(id)`, `reload(id)`, `cycleStep(list, dir)`, `cycleCommit()`, `activeInfo(): { url: string; title: string } | null`, `refresh()`, `setOverlayHeight(px: number)`, `get activeId(): string | null`.
  - `interface TabManagerOptions { isBookmarked(url: string): boolean; onNavigated(url: string, title: string): void; onSnapshot(snap: TabsSnapshot): void; onTabCreated?(wc: WebContents): void }`
  - IPC channels handled in main: `tabs:create|close|activate|navigate|back|forward|reload` (send), `tabs:updated` (push to renderer), `history:search|list` (invoke), `bookmarks:toggle-active|list` (invoke), `ui:set-overlay-height` (send), `ui:focus-urlbar` (push).
  - Preload exposes the full `SynapseApi` as `window.synapse`.

- [ ] **Step 1: Write TabManager**

`src/main/tab-manager.ts`:

```ts
import { BrowserWindow, WebContents, WebContentsView } from 'electron'
import { classifyInput } from '../shared/url-classifier'
import type { TabInfo, TabsSnapshot } from '../shared/ipc'
import { CycleList, Direction, TabModel } from './tab-model'

export const SIDEBAR_WIDTH = 240
export const TOPBAR_HEIGHT = 52

export interface TabManagerOptions {
  isBookmarked(url: string): boolean
  onNavigated(url: string, title: string): void
  onSnapshot(snap: TabsSnapshot): void
  onTabCreated?(wc: WebContents): void
}

export class TabManager {
  private model = new TabModel()
  private views = new Map<string, WebContentsView>()
  private favicons = new Map<string, string | null>()
  private attached: WebContentsView | null = null
  private overlayHeight = 0
  private counter = 0

  constructor(
    private win: BrowserWindow,
    private opts: TabManagerOptions,
  ) {
    win.on('resize', () => this.layout())
  }

  get activeId(): string | null {
    return this.model.activeId
  }

  createTab(url?: string, activate = true): string {
    const id = `tab-${++this.counter}`
    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true },
    })
    this.views.set(id, view)
    this.favicons.set(id, null)
    this.model.add(id, activate)
    this.wireEvents(id, view.webContents)
    this.opts.onTabCreated?.(view.webContents)
    if (url) view.webContents.loadURL(url)
    else this.win.webContents.send('ui:focus-urlbar')
    this.syncViews()
    return id
  }

  closeTab(id: string): void {
    const view = this.views.get(id)
    if (!view) return
    this.model.close(id)
    this.views.delete(id)
    this.favicons.delete(id)
    if (this.attached === view) {
      this.win.contentView.removeChildView(view)
      this.attached = null
    }
    view.webContents.close()
    if (this.model.order.length === 0) {
      this.createTab()
      return
    }
    this.syncViews()
  }

  activateTab(id: string): void {
    if (!this.views.has(id)) return
    this.model.activate(id)
    this.syncViews()
    this.attached?.webContents.focus()
  }

  navigate(id: string, input: string): void {
    this.views.get(id)?.webContents.loadURL(classifyInput(input))
  }

  back(id: string): void {
    const wc = this.views.get(id)?.webContents
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  forward(id: string): void {
    const wc = this.views.get(id)?.webContents
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(id: string): void {
    this.views.get(id)?.webContents.reload()
  }

  cycleStep(list: CycleList, dir: Direction): void {
    if (this.model.cycleStep(list, dir)) this.syncViews()
  }

  cycleCommit(): void {
    if (!this.model.isCycling()) return
    this.model.cycleCommit()
    this.refresh()
  }

  activeInfo(): { url: string; title: string } | null {
    const id = this.model.activeId
    if (!id) return null
    const wc = this.views.get(id)!.webContents
    return { url: wc.getURL(), title: wc.getTitle() || wc.getURL() }
  }

  setOverlayHeight(px: number): void {
    this.overlayHeight = Math.max(0, Math.round(px))
    this.layout()
  }

  refresh(): void {
    this.opts.onSnapshot(this.snapshot())
  }

  private snapshot(): TabsSnapshot {
    const tabs: Record<string, TabInfo> = {}
    for (const id of this.model.order) {
      const wc = this.views.get(id)!.webContents
      const url = wc.getURL()
      tabs[id] = {
        id,
        title: wc.getTitle() || 'New Tab',
        url,
        favicon: this.favicons.get(id) ?? null,
        isLoading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        isBookmarked: this.opts.isBookmarked(url),
      }
    }
    return { tabs, order: [...this.model.order], activeId: this.model.activeId }
  }

  private syncViews(): void {
    const active = this.model.activeId ? (this.views.get(this.model.activeId) ?? null) : null
    if (this.attached !== active) {
      if (this.attached) this.win.contentView.removeChildView(this.attached)
      if (active) this.win.contentView.addChildView(active)
      this.attached = active
    }
    this.layout()
    this.refresh()
  }

  private layout(): void {
    if (!this.attached) return
    const [w, h] = this.win.getContentSize()
    const top = TOPBAR_HEIGHT + this.overlayHeight
    this.attached.setBounds({
      x: SIDEBAR_WIDTH,
      y: top,
      width: Math.max(0, w - SIDEBAR_WIDTH),
      height: Math.max(0, h - top),
    })
  }

  private wireEvents(id: string, wc: WebContents): void {
    const refresh = () => this.refresh()
    wc.on('page-title-updated', refresh)
    wc.on('did-start-loading', refresh)
    wc.on('did-stop-loading', refresh)
    wc.on('did-navigate', refresh)
    wc.on('page-favicon-updated', (_e, favicons) => {
      this.favicons.set(id, favicons[0] ?? null)
      this.refresh()
    })
    wc.on('did-finish-load', () => {
      this.opts.onNavigated(wc.getURL(), wc.getTitle() || wc.getURL())
      this.refresh()
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) this.opts.onNavigated(url, wc.getTitle() || url)
      this.refresh()
    })
  }
}
```

- [ ] **Step 2: Rewrite main entry**

`src/main/index.ts` (replace entire file):

```ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { BookmarksStore } from './bookmarks'
import { HistoryStore } from './history'
import { TabManager } from './tab-manager'

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  const history = new HistoryStore(userData)
  const bookmarks = new BookmarksStore(userData)

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 700,
    minHeight: 400,
    title: 'Synapse Browser',
    webPreferences: { preload: join(__dirname, '../preload/index.js') },
  })

  const tabs = new TabManager(win, {
    isBookmarked: (url) => bookmarks.isBookmarked(url),
    onNavigated: (url, title) => history.add(url, title, Date.now()),
    onSnapshot: (snap) => win.webContents.send('tabs:updated', snap),
  })

  ipcMain.on('tabs:create', (_e, url?: string) => {
    tabs.createTab(typeof url === 'string' ? url : undefined)
  })
  ipcMain.on('tabs:close', (_e, id: string) => tabs.closeTab(id))
  ipcMain.on('tabs:activate', (_e, id: string) => tabs.activateTab(id))
  ipcMain.on('tabs:navigate', (_e, id: string, input: string) => tabs.navigate(id, input))
  ipcMain.on('tabs:back', (_e, id: string) => tabs.back(id))
  ipcMain.on('tabs:forward', (_e, id: string) => tabs.forward(id))
  ipcMain.on('tabs:reload', (_e, id: string) => tabs.reload(id))

  ipcMain.handle('history:search', (_e, q: string) => history.search(String(q)))
  ipcMain.handle('history:list', () => history.list())

  ipcMain.handle('bookmarks:toggle-active', () => {
    const info = tabs.activeInfo()
    if (!info || !/^https?:\/\//.test(info.url)) return
    bookmarks.toggle(info.url, info.title, Date.now())
    tabs.refresh()
  })
  ipcMain.handle('bookmarks:list', () => bookmarks.list())

  ipcMain.on('ui:set-overlay-height', (_e, px: number) => tabs.setOverlayHeight(Number(px) || 0))

  win.webContents.on('did-finish-load', () => tabs.refresh())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  tabs.createTab('https://example.com') // TEMP: Task 8 changes this to tabs.createTab()

  app.on('before-quit', () => {
    history.flush()
    bookmarks.flush()
  })
})

app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 3: Rewrite preload**

`src/preload/index.ts` (replace entire file):

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { SynapseApi } from '../shared/ipc'

const api: SynapseApi = {
  tabs: {
    create: (url) => ipcRenderer.send('tabs:create', url),
    close: (id) => ipcRenderer.send('tabs:close', id),
    activate: (id) => ipcRenderer.send('tabs:activate', id),
    navigate: (id, input) => ipcRenderer.send('tabs:navigate', id, input),
    back: (id) => ipcRenderer.send('tabs:back', id),
    forward: (id) => ipcRenderer.send('tabs:forward', id),
    reload: (id) => ipcRenderer.send('tabs:reload', id),
  },
  onTabsUpdated: (cb) => {
    ipcRenderer.on('tabs:updated', (_e, snap) => cb(snap))
  },
  history: {
    search: (q) => ipcRenderer.invoke('history:search', q),
    list: () => ipcRenderer.invoke('history:list'),
  },
  bookmarks: {
    toggleActive: () => ipcRenderer.invoke('bookmarks:toggle-active'),
    list: () => ipcRenderer.invoke('bookmarks:list'),
  },
  downloads: {
    reveal: (id) => ipcRenderer.send('downloads:reveal', id),
    onUpdated: (cb) => {
      ipcRenderer.on('downloads:updated', (_e, list) => cb(list))
    },
  },
  ui: {
    setOverlayHeight: (px) => ipcRenderer.send('ui:set-overlay-height', px),
    onFocusUrlBar: (cb) => {
      ipcRenderer.on('ui:focus-urlbar', () => cb())
    },
    onToggleHistory: (cb) => {
      ipcRenderer.on('ui:toggle-history', () => cb())
    },
    onToggleBookmarks: (cb) => {
      ipcRenderer.on('ui:toggle-bookmarks', () => cb())
    },
  },
}

contextBridge.exposeInMainWorld('synapse', api)
```

- [ ] **Step 4: Verify manually**

Run: `npm run typecheck` — expected: no errors.

Run: `npm run dev`

Expected: window opens; example.com renders to the right of the (inert) sidebar and below the top bar. Resizing the window keeps the page filling that region. Quit with Cmd+Q.

- [ ] **Step 5: Commit**

```bash
git add src/main src/preload
git commit -m "feat: TabManager with WebContentsView tabs, preload API, IPC wiring"
```

---

### Task 8: Chrome UI — sidebar + top bar

**Files:**
- Create: `src/renderer/sidebar.ts`, `src/renderer/topbar.ts`
- Modify: `src/renderer/main.ts` (full rewrite), `src/renderer/style.css` (append), `src/main/index.ts` (one line)

**Interfaces:**
- Consumes: `window.synapse` (Task 7), `TabsSnapshot` (Task 2), DOM ids from `index.html` (Task 1).
- Produces: `renderTabList(el: HTMLElement, snap: TabsSnapshot): void`; `initTopbar(): Topbar` where `interface Topbar { update(snap: TabsSnapshot): void }`. Tasks 10–12 extend `topbar.ts` and `main.ts`.

- [ ] **Step 1: Write the sidebar renderer**

`src/renderer/sidebar.ts`:

```ts
import type { TabsSnapshot } from '../shared/ipc'

export function renderTabList(el: HTMLElement, snap: TabsSnapshot): void {
  el.innerHTML = ''
  for (const id of snap.order) {
    const tab = snap.tabs[id]
    const item = document.createElement('div')
    item.className = 'tab' + (id === snap.activeId ? ' active' : '')

    const icon = document.createElement('img')
    icon.className = 'favicon'
    if (tab.favicon) icon.src = tab.favicon
    else icon.style.visibility = 'hidden'

    const title = document.createElement('span')
    title.className = 'tab-title'
    title.textContent = tab.title
    if (tab.isLoading) title.textContent = `… ${tab.title}`

    const close = document.createElement('button')
    close.className = 'tab-close'
    close.textContent = '×'
    close.title = 'Close tab'
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      window.synapse.tabs.close(id)
    })

    item.append(icon, title, close)
    item.addEventListener('click', () => window.synapse.tabs.activate(id))
    el.append(item)
  }
}
```

- [ ] **Step 2: Write the top bar controller**

`src/renderer/topbar.ts`:

```ts
import type { TabsSnapshot } from '../shared/ipc'

export interface Topbar {
  update(snap: TabsSnapshot): void
}

export function initTopbar(): Topbar {
  const back = document.getElementById('nav-back') as HTMLButtonElement
  const forward = document.getElementById('nav-forward') as HTMLButtonElement
  const reload = document.getElementById('nav-reload') as HTMLButtonElement
  const urlbar = document.getElementById('urlbar') as HTMLInputElement
  let activeId: string | null = null

  back.addEventListener('click', () => activeId && window.synapse.tabs.back(activeId))
  forward.addEventListener('click', () => activeId && window.synapse.tabs.forward(activeId))
  reload.addEventListener('click', () => activeId && window.synapse.tabs.reload(activeId))

  urlbar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && activeId && urlbar.value.trim()) {
      window.synapse.tabs.navigate(activeId, urlbar.value)
      urlbar.blur()
    }
  })

  window.synapse.ui.onFocusUrlBar(() => {
    urlbar.focus()
    urlbar.select()
  })

  return {
    update(snap) {
      activeId = snap.activeId
      const tab = activeId ? snap.tabs[activeId] : null
      back.disabled = !tab?.canGoBack
      forward.disabled = !tab?.canGoForward
      reload.disabled = !tab
      if (document.activeElement !== urlbar) urlbar.value = tab?.url ?? ''
    },
  }
}
```

- [ ] **Step 3: Rewrite renderer main**

`src/renderer/main.ts` (replace entire file):

```ts
import './style.css'
import type { TabsSnapshot } from '../shared/ipc'
import { renderTabList } from './sidebar'
import { initTopbar } from './topbar'

const tabListEl = document.getElementById('tab-list')!
const topbar = initTopbar()

let snap: TabsSnapshot = { tabs: {}, order: [], activeId: null }

window.synapse.onTabsUpdated((s) => {
  snap = s
  render()
})

document.getElementById('new-tab')!.addEventListener('click', () => window.synapse.tabs.create())

function render(): void {
  renderTabList(tabListEl, snap)
  topbar.update(snap)
}
```

- [ ] **Step 4: Append tab styles**

Append to `src/renderer/style.css`:

```css
.tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 2px;
}
.tab:hover {
  background: rgba(255, 255, 255, 0.06);
}
.tab.active {
  background: var(--bg-raised);
}
.favicon {
  width: 16px;
  height: 16px;
  flex: none;
}
.tab-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab-close {
  flex: none;
  background: none;
  border: none;
  color: var(--fg-dim);
  font-size: 14px;
  width: 18px;
  height: 18px;
  line-height: 1;
  border-radius: 4px;
  cursor: pointer;
  visibility: hidden;
}
.tab:hover .tab-close {
  visibility: visible;
}
.tab-close:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--fg);
}
```

- [ ] **Step 5: Make the initial tab blank**

In `src/main/index.ts`, replace:

```ts
tabs.createTab('https://example.com') // TEMP: Task 8 changes this to tabs.createTab()
```

with:

```ts
tabs.createTab()
```

- [ ] **Step 6: Verify manually**

Run: `npm run typecheck` — expected: no errors.

Run: `npm run dev`, then check:

1. App opens with one "New Tab" in the sidebar and the URL bar focused.
2. Type `example.com` + Enter → page loads, sidebar shows title "Example Domain", URL bar shows `https://example.com/`.
3. Type `hello world` + Enter in the URL bar → DuckDuckGo results load.
4. ＋ New Tab → second tab appears, URL bar focused; load a different site.
5. Click between tabs → pages switch, URL bar / back-forward buttons track the active tab.
6. × on a tab closes it; closing the last tab leaves a fresh New Tab.
7. Back/forward/reload buttons work.

- [ ] **Step 7: Commit**

```bash
git add src/renderer src/main/index.ts
git commit -m "feat: chrome UI with vertical tabs sidebar and top bar"
```

---

### Task 9: Popups + error pages

**Files:**
- Create: `src/main/error-page.ts`
- Modify: `src/main/tab-manager.ts` (add popup handler + failure listeners in `createTab`/`wireEvents`)
- Test: `tests/error-page.test.ts`

**Interfaces:**
- Consumes: `TabManager` internals (Task 7).
- Produces: `errorPageHtml(desc: string, url: string): string`, `errorPageDataUrl(desc: string, url: string): string`.

- [ ] **Step 1: Write the failing test**

`tests/error-page.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { errorPageDataUrl, errorPageHtml } from '../src/main/error-page'

describe('error page', () => {
  it('includes the description and a retry link to the original url', () => {
    const html = errorPageHtml('ERR_NAME_NOT_RESOLVED', 'https://nope.example')
    expect(html).toContain('ERR_NAME_NOT_RESOLVED')
    expect(html).toContain('href="https://nope.example"')
  })

  it('escapes HTML in the description and url', () => {
    const html = errorPageHtml('<script>alert(1)</script>', 'https://x.com/?q="><img>')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('"><img>')
  })

  it('produces an encoded data: url', () => {
    const url = errorPageDataUrl('oops', 'https://a.com')
    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(url)).toContain('oops')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL — cannot find module `../src/main/error-page`.

- [ ] **Step 3: Write the implementation**

`src/main/error-page.ts`:

```ts
function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function errorPageHtml(desc: string, url: string): string {
  const safeDesc = escapeHtml(desc)
  const safeUrl = escapeHtml(url)
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Page failed to load</title>
    <style>
      body { font-family: -apple-system, sans-serif; background: #1e1f24; color: #e6e6ea;
             display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
      .card { text-align: center; max-width: 480px; padding: 24px; }
      h1 { font-size: 20px; margin-bottom: 8px; }
      code { color: #9a9aa3; word-break: break-all; }
      a { display: inline-block; margin-top: 16px; color: #7aa2f7; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>This page didn’t load</h1>
      <code>${safeDesc}</code>
      <br />
      <a href="${safeUrl}">Retry</a>
    </div>
  </body>
</html>`
}

export function errorPageDataUrl(desc: string, url: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(errorPageHtml(desc, url))}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS (all files).

- [ ] **Step 5: Wire popups and failures into TabManager**

In `src/main/tab-manager.ts`, add the import:

```ts
import { errorPageDataUrl } from './error-page'
```

In `createTab`, directly after `this.opts.onTabCreated?.(view.webContents)`, add:

```ts
    view.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
      this.createTab(popupUrl)
      return { action: 'deny' }
    })
```

In `wireEvents`, add at the end of the method:

```ts
    wc.on('did-fail-load', (_e, code, desc, validatedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return // -3 = user/redirect abort, not an error
      wc.loadURL(errorPageDataUrl(desc || `Error ${code}`, validatedUrl))
    })
    wc.on('render-process-gone', (_e, details) => {
      wc.loadURL(errorPageDataUrl(`Page crashed (${details.reason})`, wc.getURL()))
    })
```

- [ ] **Step 6: Verify manually**

Run: `npm run dev`, then check:

1. Navigate to `https://this-domain-does-not-exist-abc123.com` → in-app error page with `ERR_NAME_NOT_RESOLVED` and a Retry link.
2. On a real page, a `target="_blank"` link (e.g. a result on DuckDuckGo opened via long-press menu "Open in new tab", or any site whose links open new windows) opens as a new Synapse tab, not a separate window.

- [ ] **Step 7: Commit**

```bash
git add src/main/error-page.ts src/main/tab-manager.ts tests/error-page.test.ts
git commit -m "feat: popup-to-tab handling and in-app error pages"
```

---

### Task 10: URL bar suggestions + history panel

**Files:**
- Create: `src/renderer/panel.ts`
- Modify: `src/renderer/topbar.ts` (add suggestions), `src/renderer/main.ts` (panel mode), `src/renderer/style.css` (append)

**Interfaces:**
- Consumes: `window.synapse.history` (Task 7), overlay-height IPC (Task 7).
- Produces: `type PanelMode = 'none' | 'history' | 'bookmarks'`; `renderPanel(el: HTMLElement, mode: PanelMode): Promise<void>`; `main.ts` exports nothing but owns `setPanel(mode: PanelMode)` used by footer buttons and (Task 13) menu events. Suggestion picks call `tabs.navigate`; panel item clicks open a **new tab**.
- Overlay contract: while the suggestions dropdown is visible, the renderer calls `synapse.ui.setOverlayHeight(dropdownHeightPx + 4)`; main shifts the page view down by that amount so the dropdown is never hidden behind the `WebContentsView`. On hide it must reset to 0.

- [ ] **Step 1: Add suggestions to the top bar**

In `src/renderer/topbar.ts`, replace the entire file with:

```ts
import type { HistoryEntry, TabsSnapshot } from '../shared/ipc'

export interface Topbar {
  update(snap: TabsSnapshot): void
}

export function initTopbar(): Topbar {
  const back = document.getElementById('nav-back') as HTMLButtonElement
  const forward = document.getElementById('nav-forward') as HTMLButtonElement
  const reload = document.getElementById('nav-reload') as HTMLButtonElement
  const urlbar = document.getElementById('urlbar') as HTMLInputElement
  const suggestionsEl = document.getElementById('suggestions') as HTMLDivElement
  let activeId: string | null = null
  let suggestions: HistoryEntry[] = []
  let selected = -1

  back.addEventListener('click', () => activeId && window.synapse.tabs.back(activeId))
  forward.addEventListener('click', () => activeId && window.synapse.tabs.forward(activeId))
  reload.addEventListener('click', () => activeId && window.synapse.tabs.reload(activeId))

  function hideSuggestions(): void {
    suggestions = []
    selected = -1
    suggestionsEl.hidden = true
    suggestionsEl.innerHTML = ''
    window.synapse.ui.setOverlayHeight(0)
  }

  function renderSuggestions(): void {
    suggestionsEl.innerHTML = ''
    suggestions.forEach((entry, i) => {
      const item = document.createElement('div')
      item.className = 'suggestion' + (i === selected ? ' selected' : '')
      const title = document.createElement('span')
      title.className = 'suggestion-title'
      title.textContent = entry.title
      const url = document.createElement('span')
      url.className = 'suggestion-url'
      url.textContent = entry.url
      item.append(title, url)
      // mousedown, not click: it fires before the input's blur hides the dropdown
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        pick(i)
      })
      suggestionsEl.append(item)
    })
    suggestionsEl.hidden = suggestions.length === 0
    window.synapse.ui.setOverlayHeight(suggestionsEl.hidden ? 0 : suggestionsEl.offsetHeight + 4)
  }

  function pick(i: number): void {
    const entry = suggestions[i]
    if (entry && activeId) {
      window.synapse.tabs.navigate(activeId, entry.url)
      urlbar.blur()
    }
    hideSuggestions()
  }

  urlbar.addEventListener('input', async () => {
    const q = urlbar.value.trim()
    if (!q) {
      hideSuggestions()
      return
    }
    suggestions = await window.synapse.history.search(q)
    selected = -1
    renderSuggestions()
  })

  urlbar.addEventListener('blur', () => hideSuggestions())

  urlbar.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault()
      selected = (selected + 1) % suggestions.length
      renderSuggestions()
    } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault()
      selected = (selected - 1 + suggestions.length) % suggestions.length
      renderSuggestions()
    } else if (e.key === 'Escape') {
      hideSuggestions()
    } else if (e.key === 'Enter' && activeId && urlbar.value.trim()) {
      if (selected >= 0) {
        pick(selected)
      } else {
        window.synapse.tabs.navigate(activeId, urlbar.value)
        urlbar.blur()
        hideSuggestions()
      }
    }
  })

  window.synapse.ui.onFocusUrlBar(() => {
    urlbar.focus()
    urlbar.select()
  })

  return {
    update(snap) {
      activeId = snap.activeId
      const tab = activeId ? snap.tabs[activeId] : null
      back.disabled = !tab?.canGoBack
      forward.disabled = !tab?.canGoForward
      reload.disabled = !tab
      if (document.activeElement !== urlbar) urlbar.value = tab?.url ?? ''
    },
  }
}
```

- [ ] **Step 2: Write the sidebar panel**

`src/renderer/panel.ts`:

```ts
export type PanelMode = 'none' | 'history' | 'bookmarks'

export async function renderPanel(el: HTMLElement, mode: PanelMode): Promise<void> {
  el.innerHTML = ''
  if (mode === 'none') return

  const heading = document.createElement('div')
  heading.className = 'panel-heading'
  heading.textContent = mode === 'history' ? 'History' : 'Bookmarks'
  el.append(heading)

  const items =
    mode === 'history' ? await window.synapse.history.list() : await window.synapse.bookmarks.list()

  if (items.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'panel-empty'
    empty.textContent = mode === 'history' ? 'No history yet' : 'No bookmarks yet'
    el.append(empty)
    return
  }

  for (const item of items) {
    const row = document.createElement('div')
    row.className = 'panel-item'
    const title = document.createElement('span')
    title.className = 'panel-item-title'
    title.textContent = item.title || item.url
    const url = document.createElement('span')
    url.className = 'panel-item-url'
    url.textContent = item.url
    row.append(title, url)
    row.addEventListener('click', () => window.synapse.tabs.create(item.url))
    el.append(row)
  }
}
```

- [ ] **Step 3: Wire panel mode into renderer main**

`src/renderer/main.ts` (replace entire file):

```ts
import './style.css'
import type { TabsSnapshot } from '../shared/ipc'
import { PanelMode, renderPanel } from './panel'
import { renderTabList } from './sidebar'
import { initTopbar } from './topbar'

const tabListEl = document.getElementById('tab-list')!
const panelEl = document.getElementById('panel')!
const topbar = initTopbar()

let snap: TabsSnapshot = { tabs: {}, order: [], activeId: null }
let panelMode: PanelMode = 'none'

window.synapse.onTabsUpdated((s) => {
  snap = s
  render()
})

document.getElementById('new-tab')!.addEventListener('click', () => window.synapse.tabs.create())
document.getElementById('show-history')!.addEventListener('click', () => setPanel('history'))
document.getElementById('show-bookmarks')!.addEventListener('click', () => setPanel('bookmarks'))
window.synapse.ui.onToggleHistory(() => setPanel('history'))
window.synapse.ui.onToggleBookmarks(() => setPanel('bookmarks'))

function setPanel(mode: PanelMode): void {
  panelMode = panelMode === mode ? 'none' : mode
  render()
}

function render(): void {
  renderTabList(tabListEl, snap)
  topbar.update(snap)
  tabListEl.hidden = panelMode !== 'none'
  panelEl.hidden = panelMode === 'none'
  void renderPanel(panelEl, panelMode)
}
```

- [ ] **Step 4: Append styles**

Append to `src/renderer/style.css`:

```css
.suggestion {
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  cursor: pointer;
}
.suggestion:hover,
.suggestion.selected {
  background: rgba(255, 255, 255, 0.08);
}
.suggestion-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.suggestion-url {
  color: var(--fg-dim);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel-heading {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-dim);
  padding: 6px 8px;
}
.panel-empty {
  color: var(--fg-dim);
  padding: 8px;
}
.panel-item {
  display: flex;
  flex-direction: column;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.panel-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
.panel-item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel-item-url {
  color: var(--fg-dim);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 5: Verify manually**

Run: `npm run typecheck` — expected: no errors.

Run: `npm run dev`, then check:

1. Visit a few sites. Focus the URL bar and type a fragment of a visited site's title → dropdown appears **fully visible** (page shifts down, dropdown not clipped).
2. Arrow keys move the selection; Enter on a selection navigates to it; Esc closes; blur closes and the page shifts back up.
3. 🕘 footer button shows visited pages (most recent first); clicking an entry opens it in a new tab; clicking 🕘 again returns to the tab list.
4. ★ footer button shows "No bookmarks yet".
5. Quit and relaunch (`npm run dev`) → history from the previous run still suggests.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat: url bar history suggestions and sidebar history panel"
```

---

### Task 11: Bookmarks UI

**Files:**
- Modify: `src/renderer/topbar.ts` (star button)

**Interfaces:**
- Consumes: `bookmarks:toggle-active` handler and `isBookmarked` snapshot field (Task 7), bookmarks panel (Task 10).

- [ ] **Step 1: Wire the star button**

In `src/renderer/topbar.ts`, inside `initTopbar()` add after the `reload` const:

```ts
  const star = document.getElementById('star') as HTMLButtonElement
```

after the reload click listener add:

```ts
  star.addEventListener('click', () => void window.synapse.bookmarks.toggleActive())
```

and in `update(snap)`, add at the end:

```ts
      const canBookmark = !!tab && /^https?:\/\//.test(tab.url)
      star.disabled = !canBookmark
      star.textContent = tab?.isBookmarked ? '★' : '☆'
      star.classList.toggle('starred', !!tab?.isBookmarked)
```

- [ ] **Step 2: Append style**

Append to `src/renderer/style.css`:

```css
#star.starred {
  color: #f7c67a;
}
```

- [ ] **Step 3: Verify manually**

Run: `npm run dev`, then check:

1. On a loaded page, click ☆ → turns gold ★ immediately (snapshot refresh).
2. ★ footer panel lists the bookmark; clicking it opens the page in a new tab; the new tab's star is already ★.
3. Click ★ in the top bar again → unbookmarks (back to ☆, gone from the panel).
4. On a blank New Tab the star is disabled.
5. Relaunch → bookmark persists.

- [ ] **Step 4: Commit**

```bash
git add src/renderer
git commit -m "feat: bookmark star button"
```

---

### Task 12: Downloads

**Files:**
- Create: `src/main/unique-path.ts`, `src/main/downloads.ts`
- Modify: `src/main/index.ts` (attach + IPC), `src/renderer/topbar.ts` (pill)
- Test: `tests/unique-path.test.ts`

**Interfaces:**
- Consumes: `DownloadInfo` (Task 2), preload `downloads` API (Task 7).
- Produces:
  - `uniquePath(dir: string, filename: string, exists?: (p: string) => boolean): string`
  - `class DownloadManager` — `constructor(onUpdate: (list: DownloadInfo[]) => void)`, `attach(session: Session): void`, `reveal(id: string): void`.
  - IPC: `downloads:updated` (push), `downloads:reveal` (send).

- [ ] **Step 1: Write the failing test**

`tests/unique-path.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { uniquePath } from '../src/main/unique-path'

describe('uniquePath', () => {
  it('returns dir/filename when nothing exists', () => {
    expect(uniquePath('/dl', 'report.pdf', () => false)).toBe('/dl/report.pdf')
  })

  it('appends (1), (2)... until the name is free', () => {
    const taken = new Set(['/dl/report.pdf', '/dl/report (1).pdf'])
    expect(uniquePath('/dl', 'report.pdf', (p) => taken.has(p))).toBe('/dl/report (2).pdf')
  })

  it('handles names without extensions', () => {
    const taken = new Set(['/dl/README'])
    expect(uniquePath('/dl', 'README', (p) => taken.has(p))).toBe('/dl/README (1)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL — cannot find module `../src/main/unique-path`.

- [ ] **Step 3: Write uniquePath**

`src/main/unique-path.ts`:

```ts
import * as fs from 'node:fs'
import * as path from 'node:path'

export function uniquePath(
  dir: string,
  filename: string,
  exists: (p: string) => boolean = fs.existsSync,
): string {
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  let candidate = path.join(dir, filename)
  let i = 1
  while (exists(candidate)) {
    candidate = path.join(dir, `${base} (${i++})${ext}`)
  }
  return candidate
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS (all files).

- [ ] **Step 5: Write DownloadManager and wire it up**

`src/main/downloads.ts`:

```ts
import { app, shell } from 'electron'
import type { Session } from 'electron'
import * as path from 'node:path'
import type { DownloadInfo } from '../shared/ipc'
import { uniquePath } from './unique-path'

export class DownloadManager {
  private list: DownloadInfo[] = []
  private paths = new Map<string, string>()
  private counter = 0

  constructor(private onUpdate: (list: DownloadInfo[]) => void) {}

  attach(session: Session): void {
    session.on('will-download', (_e, item) => {
      const id = `dl-${++this.counter}`
      const savePath = uniquePath(app.getPath('downloads'), item.getFilename())
      item.setSavePath(savePath)
      this.paths.set(id, savePath)
      const info: DownloadInfo = {
        id,
        filename: path.basename(savePath),
        state: 'progressing',
        receivedBytes: 0,
        totalBytes: item.getTotalBytes(),
      }
      this.list.push(info)
      this.emit()
      item.on('updated', () => {
        info.receivedBytes = item.getReceivedBytes()
        this.emit()
      })
      item.once('done', (_ev, state) => {
        info.state = state === 'completed' ? 'completed' : 'failed'
        info.receivedBytes = item.getReceivedBytes()
        this.emit()
      })
    })
  }

  reveal(id: string): void {
    const p = this.paths.get(id)
    const info = this.list.find((d) => d.id === id)
    if (p && info?.state === 'completed') shell.showItemInFolder(p)
  }

  private emit(): void {
    this.onUpdate([...this.list])
  }
}
```

In `src/main/index.ts`:

Add imports:

```ts
import { session } from 'electron'
import { DownloadManager } from './downloads'
```

(merge the `session` import into the existing `from 'electron'` import line).

After the `tabs` construction, add:

```ts
  const downloads = new DownloadManager((list) => win.webContents.send('downloads:updated', list))
  downloads.attach(session.defaultSession)
  ipcMain.on('downloads:reveal', (_e, id: string) => downloads.reveal(id))
```

- [ ] **Step 6: Add the pill to the top bar**

In `src/renderer/topbar.ts`, inside `initTopbar()` add after the `star` const:

```ts
  const pill = document.getElementById('download-pill') as HTMLButtonElement
  let latestDownload: import('../shared/ipc').DownloadInfo | null = null

  window.synapse.downloads.onUpdated((list) => {
    latestDownload = list[list.length - 1] ?? null
    renderPill()
  })

  pill.addEventListener('click', () => {
    if (latestDownload?.state === 'completed') window.synapse.downloads.reveal(latestDownload.id)
  })

  function renderPill(): void {
    if (!latestDownload) {
      pill.hidden = true
      return
    }
    pill.hidden = false
    const d = latestDownload
    if (d.state === 'progressing') {
      const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0
      pill.textContent = `↓ ${d.filename} ${pct}%`
    } else if (d.state === 'completed') {
      pill.textContent = `✓ ${d.filename}`
      pill.title = 'Show in Finder'
    } else {
      pill.textContent = `✕ ${d.filename}`
      pill.title = 'Download failed'
    }
  }
```

- [ ] **Step 7: Verify manually**

Run: `npm run typecheck` — expected: no errors.

Run: `npm run dev`, then:

1. Navigate to a page with a downloadable file (e.g. search "electron releases" and grab a `.zip`, or any PDF link with a download attribute) → pill shows `↓ name NN%` then `✓ name`.
2. File lands in `~/Downloads` (with ` (1)` suffix if it already existed).
3. Click the ✓ pill → Finder opens with the file selected.

- [ ] **Step 8: Commit**

```bash
git add src/main src/renderer tests/unique-path.test.ts
git commit -m "feat: downloads to ~/Downloads with progress pill"
```

---

### Task 13: Application menu + shortcuts

**Files:**
- Create: `src/main/menu.ts`
- Modify: `src/main/index.ts` (build menu)

**Interfaces:**
- Consumes: `TabManager` (Task 7), `bookmarks:toggle-active` logic (Task 7), renderer events `ui:focus-urlbar` / `ui:toggle-history` / `ui:toggle-bookmarks` (Tasks 8/10).
- Produces: `buildMenu(win: BrowserWindow, tabs: TabManager, toggleBookmark: () => void): void` — sets the application menu. Shortcuts: Cmd+T, Cmd+W, Cmd+L, Cmd+R, Cmd+[, Cmd+], Cmd+D, Cmd+Y, Cmd+Shift+B.

- [ ] **Step 1: Write the menu**

`src/main/menu.ts`:

```ts
import { BrowserWindow, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import type { TabManager } from './tab-manager'

export function buildMenu(win: BrowserWindow, tabs: TabManager, toggleBookmark: () => void): void {
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => tabs.createTab() },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            if (tabs.activeId) tabs.closeTab(tabs.activeId)
          },
        },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Page',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (tabs.activeId) tabs.reload(tabs.activeId)
          },
        },
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: () => {
            if (tabs.activeId) tabs.back(tabs.activeId)
          },
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => {
            if (tabs.activeId) tabs.forward(tabs.activeId)
          },
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Focus Address Bar',
          accelerator: 'CmdOrCtrl+L',
          click: () => win.webContents.send('ui:focus-urlbar'),
        },
        { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: () => toggleBookmark() },
        {
          label: 'History',
          accelerator: 'CmdOrCtrl+Y',
          click: () => win.webContents.send('ui:toggle-history'),
        },
        {
          label: 'Bookmarks',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => win.webContents.send('ui:toggle-bookmarks'),
        },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
```

- [ ] **Step 2: Wire into main**

In `src/main/index.ts`:

Add import:

```ts
import { buildMenu } from './menu'
```

Extract the bookmark-toggle logic so the menu and IPC share it. Replace the `bookmarks:toggle-active` handler with:

```ts
  const toggleBookmark = (): void => {
    const info = tabs.activeInfo()
    if (!info || !/^https?:\/\//.test(info.url)) return
    bookmarks.toggle(info.url, info.title, Date.now())
    tabs.refresh()
  }
  ipcMain.handle('bookmarks:toggle-active', () => toggleBookmark())
```

After the `downloads` wiring, add:

```ts
  buildMenu(win, tabs, toggleBookmark)
```

- [ ] **Step 3: Verify manually**

Run: `npm run typecheck` — expected: no errors.

Run: `npm run dev`, then check each shortcut:

1. Cmd+T → new tab, URL bar focused. Cmd+W → closes the active tab (window stays open; last tab is replaced by a fresh one).
2. Cmd+L → focuses + selects the URL bar even when the page has focus.
3. Cmd+R reloads; Cmd+[ / Cmd+] go back/forward.
4. Cmd+D stars the page; Cmd+Y toggles the history panel; Cmd+Shift+B toggles bookmarks.
5. Cmd+C/Cmd+V work in the URL bar (editMenu role).

- [ ] **Step 4: Commit**

```bash
git add src/main
git commit -m "feat: application menu with keyboard shortcuts"
```

---

### Task 14: Tab cycling (Ctrl+Tab MRU / Option+Tab order)

**Files:**
- Modify: `src/main/index.ts` (input hooks)

**Interfaces:**
- Consumes: `TabManager.cycleStep/cycleCommit` (Task 7), `TabModel` cycling semantics (Task 4), `onTabCreated` option (Task 7).
- Behavior: Ctrl+Tab / Ctrl+Shift+Tab walks MRU; Option+Tab / Option+Shift+Tab walks sidebar order; releasing the held modifier commits (promotes the landed tab in MRU). Works whether focus is in a web page or the chrome UI.

- [ ] **Step 1: Attach before-input-event hooks**

In `src/main/index.ts`, add `WebContents` to the electron type imports:

```ts
import type { WebContents } from 'electron'
```

Inside `app.whenReady().then(...)`, add this function declaration before the `TabManager` construction (function declarations hoist; `tabs` is resolved at call time):

```ts
  function attachCycleHooks(wc: WebContents): void {
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Tab' && (input.control || input.alt)) {
        event.preventDefault()
        tabs.cycleStep(input.control ? 'mru' : 'order', input.shift ? 'back' : 'forward')
      } else if (input.type === 'keyUp' && (input.key === 'Control' || input.key === 'Alt')) {
        tabs.cycleCommit()
      }
    })
  }
```

Add the option to the `TabManager` construction:

```ts
  const tabs = new TabManager(win, {
    isBookmarked: (url) => bookmarks.isBookmarked(url),
    onNavigated: (url, title) => history.add(url, title, Date.now()),
    onSnapshot: (snap) => win.webContents.send('tabs:updated', snap),
    onTabCreated: (wc) => attachCycleHooks(wc),
  })
```

And after the `tabs` construction, hook the chrome UI's own webContents:

```ts
  attachCycleHooks(win.webContents)
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, open four tabs A, B, C, D (click A, then B, then C, then D so MRU is D,C,B,A), then check:

1. Quick Ctrl+Tab tap → jumps to C (previous tab). Ctrl+Tab again → back to D. (Toggle behavior.)
2. Hold Ctrl, press Tab twice → previews C then B; release Ctrl → lands on B. Quick Ctrl+Tab now returns to D (B is MRU front, D second).
3. Ctrl+Shift+Tab walks the MRU list the other way.
4. Option+Tab → next tab in **sidebar order** (wraps last→first). Option+Shift+Tab → previous.
5. Cycling works both when a web page has focus and when the URL bar has focus.
6. Ctrl keyup without a preceding Ctrl+Tab does nothing (no spurious MRU changes).

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: MRU (Ctrl+Tab) and order (Option+Tab) tab cycling with commit-on-release"
```

---

### Task 15: Final verification, README, repo docs

**Files:**
- Create: `README.md`
- Modify: `.agents/REPO_RULES.md` (replace — it still describes Synapse Meetings, copied from another repo)

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Run the full check suite**

Run: `npm test` — expected: PASS, 8 test files (url-classifier, history-search, tab-model, store, history, bookmarks, error-page, unique-path).

Run: `npm run typecheck` — expected: no errors.

Run: `npm run build` — expected: builds `out/` without errors.

- [ ] **Step 2: Full manual smoke pass**

Run: `npm run dev` and walk the checklist:

1. Browse: URL, domain shorthand, search fallback all work.
2. Tabs: create, close, activate, popups open as tabs, last-tab close leaves a fresh tab.
3. Cycling: Ctrl+Tab MRU toggle + deep walk, Option+Tab order walk.
4. Suggestions: appear fully visible, keyboard navigable, persist across restart.
5. Bookmarks: star, panel, persist across restart.
6. Downloads: progress pill, lands in ~/Downloads, reveal in Finder.
7. Error page on a bad domain; Retry link works.
8. All menu shortcuts from Task 13.

Fix anything broken before proceeding (use superpowers:systematic-debugging if a step fails).

- [ ] **Step 3: Write README**

`README.md`:

````markdown
# Synapse Browser

A very simple Chromium browser for macOS, built on Electron.

## Features

- Vertical tabs (Arc-style sidebar)
- URL bar with history suggestions (DuckDuckGo search fallback)
- MRU tab cycling: Ctrl+Tab / Ctrl+Shift+Tab (hold to walk, release to commit)
- Sidebar-order cycling: Option+Tab / Option+Shift+Tab
- Bookmarks (Cmd+D), History (Cmd+Y), Downloads to ~/Downloads
- In-app error pages, popup-to-tab handling

## Development

```bash
npm install
npm run dev        # run with hot reload
npm test           # unit tests (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # production build to out/
```

## Architecture

- `src/main/` — main process: `TabManager` (WebContentsView per tab), stores, downloads, menu
- `src/main/tab-model.ts` — pure tab state machine (order, MRU, cycling) — fully unit tested
- `src/preload/` — exposes `window.synapse` (typed in `src/shared/ipc.ts`) to the chrome UI
- `src/renderer/` — chrome UI (sidebar + top bar), vanilla TS, pure function of `tabs:updated` snapshots

Web page tabs are sandboxed with no preload and no IPC access.
````

- [ ] **Step 4: Replace `.agents/REPO_RULES.md`**

Replace the entire file contents with:

```markdown
# Synapse Browser — Repo Rules

## Build & Run

Electron + electron-vite + TypeScript. No native build steps.

- `npm run dev` — run the app (electron-vite dev, hot reload)
- `npm test` — Vitest unit tests
- `npm run typecheck` — `tsc --noEmit` (CI-grade check; run before claiming done)
- `npm run build` — production bundle to `out/`

## Architecture (the part you can't grep)

- All tab state lives in the **main process**. `src/main/tab-model.ts` is a pure,
  Electron-free state machine (sidebar order, MRU order, hold-and-walk cycling);
  `src/main/tab-manager.ts` binds it to `WebContentsView`s. The chrome UI renderer is a
  pure function of `tabs:updated` snapshots — it holds no tab state of its own.
- Tab cycling (Ctrl+Tab = MRU, Option+Tab = sidebar order) is captured via
  `before-input-event` in main, NOT menu accelerators — commit-on-modifier-release needs
  key-up events, which accelerators can't see.
- The suggestions dropdown can't overlap the page (`WebContentsView`s always draw above
  the window's own renderer), so the renderer reports the dropdown height over
  `ui:set-overlay-height` and main shifts the page view down. Reset to 0 on close or the
  page stays shifted.
- Web page tabs are sandboxed, get **no preload** and zero IPC exposure. Only the chrome
  UI gets `window.synapse` (typed as `SynapseApi` in `src/shared/ipc.ts`).
- Stores are debounced JSON (`history.json`, `bookmarks.json`) in `userData`; corrupt
  files become `<name>.bad` and are recreated. Schema carries `v: 1`.

## Conventions

- TypeScript strict; no runtime npm dependencies; no UI framework in the renderer.
- Pure logic goes in Electron-free modules (`src/shared/`, `tab-model.ts`) with Vitest
  coverage; Electron-coupled code is verified by manual smoke (see README).
- Short conventional commits (`feat:`, `fix:`, `chore:`).
```

- [ ] **Step 5: Commit**

```bash
git add README.md .agents/REPO_RULES.md
git commit -m "docs: README and repo rules for Synapse Browser"
```

---

## Done

All 15 tasks complete = v1 shipped: browse, tabs, cycling, suggestions, history, bookmarks, downloads, shortcuts, error pages — tested where pure, smoke-verified where Electron-coupled.
