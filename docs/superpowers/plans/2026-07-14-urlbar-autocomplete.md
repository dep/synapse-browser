# URL Bar Autocomplete & Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Awesomebar-quality URL bar: inline autocomplete with selected remainder, frecency ranking (frequency + recency + bookmark bonus), multi-word title+URL matching, favicons, bold matched text, bookmark star badge.

**Architecture:** The pure scorer `src/shared/history-search.ts` is rewritten (token-AND matching, frecency, autofill candidate) and returns a new `Suggestion` payload over the existing `history:search` IPC channel. A new `favicons.json` host→URL store in main is fed from tab-manager's existing `page-favicon-updated` hook. The renderer (`topbar.ts`) adds inline autofill mechanics and richer dropdown rows.

**Tech Stack:** Electron + electron-vite, TypeScript strict, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-14-urlbar-autocomplete-design.md`

## Global Constraints

- TypeScript strict; no runtime npm dependencies added.
- Pure logic stays in Electron-free modules (`src/shared/`) with Vitest coverage; Electron-coupled code is verified by manual smoke.
- Renderer builds DOM with nodes/`textContent` — never `innerHTML` containing page data (titles/URLs). `innerHTML` is allowed only for our own static SVG icon strings.
- Short conventional commits (`feat:`, `fix:`, `chore:`).
- Run `npm run typecheck` before claiming any task done.
- Frecency weights (spec §1): visit age ≤4d → 100, ≤14d → 70, ≤31d → 50, ≤90d → 30, older → 10. Bookmark bonus 150. Result limit 6.

---

### Task 1: Rewrite the pure scorer (`history-search.ts`) + `Suggestion` type

**Files:**
- Modify: `src/shared/ipc.ts` (add `Suggestion`, change `history.search` return type)
- Modify: `src/shared/history-search.ts` (full rewrite)
- Modify: `src/main/history.ts:30-32` (`search` signature — pass `Date.now()`, default limit 6)
- Test: `tests/history-search.test.ts` (full rewrite)
- Test: `tests/history.test.ts:63-67` (default limit 5 → 6)

**Interfaces:**
- Consumes: existing `HistoryEntry { url, title, visitedAt }`, `Bookmark` from `src/shared/ipc.ts`.
- Produces (later tasks rely on these exact names):
  - `interface Suggestion { url: string; title: string; favicon: string | null; isBookmark: boolean; autocomplete: string | null }` in `src/shared/ipc.ts`
  - `searchSuggestions(entries: HistoryEntry[], bookmarks: SuggestionBookmark[], query: string, now: number, limit = 6): Suggestion[]`
  - `SuggestionBookmark = Pick<Bookmark, 'url' | 'title' | 'createdAt'> & { favicon?: string | null }`
  - `stripUrl(url: string): string` (exported — renderer uses it for display)
  - `SynapseApi['history']['search'](q: string): Promise<Suggestion[]>`

- [ ] **Step 1: Add the `Suggestion` type to `src/shared/ipc.ts`**

Below the `HistoryEntry` interface (line 44) add:

```ts
export interface Suggestion {
  url: string
  title: string
  favicon: string | null
  isBookmark: boolean
  autocomplete: string | null // set only on row 0, when it can complete the typed text
}
```

Change `SynapseApi.history.search` (line 97) to:

```ts
    search(q: string): Promise<Suggestion[]>
```

- [ ] **Step 2: Replace `tests/history-search.test.ts` with the new suite (failing)**

Full file contents:

```ts
import { describe, expect, it } from 'vitest'
import { searchSuggestions } from '../src/shared/history-search'
import type { HistoryEntry, Suggestion } from '../src/shared/ipc'

const DAY = 86_400_000
const NOW = 1_000 * DAY // fixed clock, larger than any visit age used below

const e = (url: string, title: string, visitedAt = NOW - DAY): HistoryEntry => ({
  url,
  title,
  visitedAt,
})
const bm = (url: string, title: string, favicon: string | null = null) => ({
  url,
  title,
  createdAt: NOW - DAY,
  favicon,
})
const urls = (results: Suggestion[]): string[] => results.map((s) => s.url)

describe('token matching', () => {
  it('requires every token to match (AND)', () => {
    const entries = [e('https://a.com', 'Alpha Site'), e('https://b.com', 'Beta Site')]
    expect(urls(searchSuggestions(entries, [], 'alpha site', NOW))).toEqual(['https://a.com'])
    expect(searchSuggestions(entries, [], 'alpha beta', NOW)).toEqual([])
  })

  it('matches tokens across title and url together — "play Daily" regression', () => {
    const entries = [
      e('https://play.google.com/books', 'My Daily Briefing'),
      e('https://example.com/other', 'Some Daily Thing'),
    ]
    expect(urls(searchSuggestions(entries, [], 'play Daily', NOW))).toEqual([
      'https://play.google.com/books',
    ])
  })

  it('is case-insensitive', () => {
    const entries = [e('https://a.com', 'Alpha')]
    expect(searchSuggestions(entries, [], 'ALPHA', NOW)).toHaveLength(1)
  })

  it('ranks word-boundary matches above mid-string matches', () => {
    const entries = [
      e('https://concatenate.com', 'String utils'), // 'cat' mid-word
      e('https://cat-pictures.com', 'Cats'), // 'cat' at a boundary
    ]
    expect(urls(searchSuggestions(entries, [], 'cat', NOW))).toEqual([
      'https://cat-pictures.com',
      'https://concatenate.com',
    ])
  })

  it('does not match char subsequences', () => {
    const entries = [e('https://sub-sequence.com', 'x grep y')]
    expect(searchSuggestions(entries, [], 'gp', NOW)).toEqual([])
  })

  it('returns [] for empty or whitespace query', () => {
    expect(searchSuggestions([e('https://a.com', 'A')], [], '', NOW)).toEqual([])
    expect(searchSuggestions([e('https://a.com', 'A')], [], '  ', NOW)).toEqual([])
  })
})

describe('frecency ranking', () => {
  it('a recent visit outweighs many ancient visits', () => {
    const entries = [
      e('https://old.com/page', 'Old', NOW - 200 * DAY),
      e('https://old.com/page', 'Old', NOW - 201 * DAY),
      e('https://old.com/page', 'Old', NOW - 202 * DAY),
      e('https://old.com/page', 'Old', NOW - 203 * DAY),
      e('https://fresh.com/page', 'Fresh', NOW - DAY),
    ]
    // old: 4 visits x 10 = 40; fresh: 1 visit x 100
    expect(urls(searchSuggestions(entries, [], 'page', NOW))[0]).toBe('https://fresh.com/page')
  })

  it('more visits win at equal recency', () => {
    const entries = [
      e('https://rare.com/page', 'Rare'),
      e('https://often.com/page', 'Often'),
      e('https://often.com/page', 'Often'),
    ]
    expect(urls(searchSuggestions(entries, [], 'page', NOW))).toEqual([
      'https://often.com/page',
      'https://rare.com/page',
    ])
  })

  it('bookmark bonus beats a modest visit edge', () => {
    // both old: kept = 10 + 150; busy = 3 x 10
    const entries = [
      e('https://busy.com/page', 'Busy', NOW - 100 * DAY),
      e('https://busy.com/page', 'Busy', NOW - 101 * DAY),
      e('https://busy.com/page', 'Busy', NOW - 102 * DAY),
      e('https://kept.com/page', 'Kept', NOW - 100 * DAY),
    ]
    expect(urls(searchSuggestions(entries, [bm('https://kept.com/page', 'Kept')], 'page', NOW))).toEqual([
      'https://kept.com/page',
      'https://busy.com/page',
    ])
  })

  it('a heavily-used site outranks a never-visited bookmark', () => {
    // daily: 2 x 100 = 200 > bookmark-only 150
    const entries = [
      e('https://daily.com/page', 'Daily', NOW - DAY),
      e('https://daily.com/page', 'Daily', NOW - 2 * DAY),
    ]
    expect(urls(searchSuggestions(entries, [bm('https://saved.com/page', 'Saved page')], 'page', NOW))).toEqual([
      'https://daily.com/page',
      'https://saved.com/page',
    ])
  })

  it('dedupes by url; newest title wins; all visits count', () => {
    const entries = [
      e('https://a.com', 'Newest', NOW - DAY),
      e('https://a.com', 'Older', NOW - 2 * DAY),
    ]
    const results = searchSuggestions(entries, [], 'a.com', NOW)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Newest')
  })

  it('limits to 6 by default', () => {
    const entries = Array.from({ length: 10 }, (_, i) => e(`https://site${i}.com`, `Site ${i}`))
    expect(searchSuggestions(entries, [], 'site', NOW)).toHaveLength(6)
  })
})

describe('bookmarks', () => {
  it('surfaces never-visited bookmarks by bookmark title', () => {
    const results = searchSuggestions([], [bm('https://docs.example.com', 'Example Docs')], 'docs', NOW)
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://docs.example.com')
    expect(results[0].title).toBe('Example Docs')
    expect(results[0].isBookmark).toBe(true)
  })

  it('a visited bookmark keeps the history title but matches its bookmark title', () => {
    const entries = [e('https://chase.com/login', 'Sign In')]
    const results = searchSuggestions(entries, [bm('https://chase.com/login', 'Banking')], 'banking', NOW)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Sign In')
    expect(results[0].isBookmark).toBe(true)
  })

  it('carries the bookmark favicon', () => {
    const results = searchSuggestions([], [bm('https://a.com', 'A', 'https://a.com/i.png')], 'a.com', NOW)
    expect(results[0].favicon).toBe('https://a.com/i.png')
  })

  it('plain history rows have favicon null and isBookmark false', () => {
    const results = searchSuggestions([e('https://a.com', 'A')], [], 'a.com', NOW)
    expect(results[0].favicon).toBeNull()
    expect(results[0].isBookmark).toBe(false)
  })
})

describe('inline autocomplete', () => {
  it('offers host completion when typed text is a host prefix', () => {
    const entries = [e('https://feedback.limitless.ai/posts/1', 'Limitless feature requests')]
    const [top] = searchSuggestions(entries, [], 'fe', NOW)
    expect(top.autocomplete).toBe('feedback.limitless.ai/')
  })

  it('ignores scheme and www. for the prefix', () => {
    const entries = [e('https://www.nytimes.com/section/food', 'Food')]
    const [top] = searchSuggestions(entries, [], 'nyt', NOW)
    expect(top.autocomplete).toBe('nytimes.com/')
  })

  it('completes the full url once typing extends into the path', () => {
    const entries = [e('https://a.com/deep/page', 'Deep')]
    const [top] = searchSuggestions(entries, [], 'a.com/de', NOW)
    expect(top.autocomplete).toBe('a.com/deep/page')
  })

  it('promotes the autofill candidate to rank 1 with autocomplete set only there', () => {
    const entries = [
      e('https://news.ycombinator.com', 'Hacker News feed', NOW - DAY),
      e('https://news.ycombinator.com', 'Hacker News feed', NOW - DAY),
      e('https://feedback.limitless.ai/', 'Limitless feature requests', NOW - 100 * DAY),
    ]
    // 'fee' matches HN title ('feed') with higher frecency, but only prefixes feedback.*
    const results = searchSuggestions(entries, [], 'fee', NOW)
    expect(results[0].url).toBe('https://feedback.limitless.ai/')
    expect(results[0].autocomplete).toBe('feedback.limitless.ai/')
    expect(results.slice(1).every((s) => s.autocomplete === null)).toBe(true)
  })

  it('picks the highest-frecency prefix candidate', () => {
    const entries = [
      e('https://feedly.com', 'Feedly', NOW - 100 * DAY),
      e('https://feedback.limitless.ai/', 'Limitless', NOW - DAY),
    ]
    const [top] = searchSuggestions(entries, [], 'fee', NOW)
    expect(top.autocomplete).toBe('feedback.limitless.ai/')
  })

  it('never offers autocomplete for multi-word queries', () => {
    const entries = [e('https://play.google.com/books', 'My Daily Briefing')]
    const [top] = searchSuggestions(entries, [], 'play Daily', NOW)
    expect(top.autocomplete).toBeNull()
  })

  it('offers nothing when no result prefixes the typed text', () => {
    const entries = [e('https://a.com', 'Feedback hub')]
    const [top] = searchSuggestions(entries, [], 'fee', NOW)
    expect(top.autocomplete).toBeNull()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/history-search.test.ts`
Expected: FAIL (wrong signature/shape — old implementation).

- [ ] **Step 4: Rewrite `src/shared/history-search.ts`**

Full file contents:

```ts
import type { Bookmark, HistoryEntry, Suggestion } from './ipc'

export type SuggestionBookmark = Pick<Bookmark, 'url' | 'title' | 'createdAt'> & {
  favicon?: string | null
}

const DAY = 86_400_000
// Firefox-style frecency buckets: a visit's weight decays with age
const BUCKETS: [maxAgeDays: number, weight: number][] = [
  [4, 100],
  [14, 70],
  [31, 50],
  [90, 30],
]
const OLD_WEIGHT = 10
const BOOKMARK_BONUS = 150

interface Candidate {
  url: string
  stripped: string
  title: string
  bookmarkTitle: string | null
  favicon: string | null
  isBookmark: boolean
  visits: number[]
  lastVisit: number
}

export function stripUrl(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '')
}

function visitWeight(age: number): number {
  for (const [days, weight] of BUCKETS) if (age <= days * DAY) return weight
  return OLD_WEIGHT
}

function hasBoundaryMatch(hay: string, token: string): boolean {
  for (let i = hay.indexOf(token); i !== -1; i = hay.indexOf(token, i + 1)) {
    if (i === 0 || !/[a-z0-9]/.test(hay[i - 1])) return true
  }
  return false
}

// 2 = every token starts at a word boundary, 1 = every token a substring, 0 = miss
function matchTier(tokens: string[], hay: string): number {
  let tier = 2
  for (const token of tokens) {
    if (!hay.includes(token)) return 0
    if (!hasBoundaryMatch(hay, token)) tier = 1
  }
  return tier
}

// Candidates are unique history URLs (all visit timestamps collected — the
// frecency signal) plus never-visited bookmarks. Rank: match tier, then
// frecency + bookmark bonus, then last visit. A single-token query that
// prefixes a candidate's scheme-less URL yields an inline autocomplete,
// promoted to rank 1.
export function searchSuggestions(
  entries: HistoryEntry[],
  bookmarks: SuggestionBookmark[],
  query: string,
  now: number,
  limit = 6,
): Suggestion[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const tokens = q.split(/\s+/)

  const byUrl = new Map<string, Candidate>()
  for (const entry of entries) {
    const c = byUrl.get(entry.url)
    if (c) {
      // entries are newest-first, so the first occurrence already holds the freshest title
      c.visits.push(entry.visitedAt)
      c.lastVisit = Math.max(c.lastVisit, entry.visitedAt)
    } else {
      byUrl.set(entry.url, {
        url: entry.url,
        stripped: stripUrl(entry.url),
        title: entry.title,
        bookmarkTitle: null,
        favicon: null,
        isBookmark: false,
        visits: [entry.visitedAt],
        lastVisit: entry.visitedAt,
      })
    }
  }
  for (const b of bookmarks) {
    const c = byUrl.get(b.url)
    if (c) {
      // a visited bookmark stays findable by its user-chosen name, not just
      // the page title its history entries carry
      c.bookmarkTitle = b.title
      c.isBookmark = true
      c.favicon = b.favicon ?? null
    } else {
      byUrl.set(b.url, {
        url: b.url,
        stripped: stripUrl(b.url),
        title: b.title,
        bookmarkTitle: b.title,
        favicon: b.favicon ?? null,
        isBookmark: true,
        visits: [],
        lastVisit: b.createdAt,
      })
    }
  }

  const scored: { c: Candidate; tier: number; score: number }[] = []
  for (const c of byUrl.values()) {
    const hay = `${c.title} ${c.bookmarkTitle ?? ''} ${c.stripped}`.toLowerCase()
    const tier = matchTier(tokens, hay)
    if (tier === 0) continue
    const frecency = c.visits.reduce((sum, v) => sum + visitWeight(now - v), 0)
    scored.push({ c, tier, score: frecency + (c.isBookmark ? BOOKMARK_BONUS : 0) })
  }
  scored.sort((a, b) => b.tier - a.tier || b.score - a.score || b.c.lastVisit - a.c.lastVisit)

  let results = scored.slice(0, limit)
  let autocomplete: string | null = null
  if (tokens.length === 1) {
    const match = scored.find((s) => s.c.stripped.toLowerCase().startsWith(q))
    if (match) {
      const stripped = match.c.stripped
      const slash = stripped.indexOf('/')
      const hostEnd = slash === -1 ? stripped.length : slash
      autocomplete = q.length <= hostEnd ? `${stripped.slice(0, hostEnd)}/` : stripped
      results = [match, ...results.filter((s) => s !== match)].slice(0, limit)
    }
  }

  return results.map(({ c }, i) => ({
    url: c.url,
    title: c.title,
    favicon: c.favicon,
    isBookmark: c.isBookmark,
    autocomplete: i === 0 ? autocomplete : null,
  }))
}
```

- [ ] **Step 5: Update `src/main/history.ts` search method**

Replace lines 30-32 with (add `Suggestion` to the type import from `'../shared/ipc'`):

```ts
  search(query: string, limit = 6): Suggestion[] {
    return searchSuggestions(this.store.get().entries, [], query, Date.now(), limit)
  }
```

- [ ] **Step 6: Update `tests/history.test.ts` default-limit test**

Replace the test at lines 63-67 with:

```ts
  it('search respects the limit parameter and defaults to 6', () => {
    for (let i = 0; i < 8; i++) store.add(`https://site${i}.com`, `Site ${i}`, i)
    expect(store.search('site', 3)).toHaveLength(3)
    expect(store.search('site')).toHaveLength(6)
  })
```

- [ ] **Step 7: Run tests — expect one remaining failure outside this task's scope**

Run: `npx vitest run tests/history-search.test.ts tests/history.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: errors ONLY in `src/main/index.ts` (searchSuggestions arity) and `src/renderer/topbar.ts` (HistoryEntry vs Suggestion) — those are Tasks 2 and 3. If `src/main/index.ts` blocks the commit hook, apply Task 2 Step 4's `index.ts` change for arity early (add `Date.now()`), but do NOT wire favicons yet.

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc.ts src/shared/history-search.ts src/main/history.ts tests/history-search.test.ts tests/history.test.ts
git commit -m "feat: frecency + token-matching urlbar suggestion scorer"
```

---

### Task 2: Favicon store + main-process wiring

**Files:**
- Create: `src/main/favicons.ts`
- Test: `tests/favicons.test.ts`
- Modify: `src/main/tab-manager.ts:25` (opts interface) and `:672-676` (`page-favicon-updated` handler)
- Modify: `src/main/index.ts` (instantiate store, wire opts callback, update `history:search` handler at ~line 310, flush at ~line 688)

**Interfaces:**
- Consumes: `JsonStore` from `src/main/store.ts`; `searchSuggestions(entries, marks, q, now)` from Task 1.
- Produces: `class FaviconStore { constructor(dir: string); set(pageUrl: string, favicon: string | null): void; get(url: string): string | null; flush(): void }`

- [ ] **Step 1: Write `tests/favicons.test.ts` (failing)**

```ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FaviconStore } from '../src/main/favicons'

describe('FaviconStore', () => {
  let dir: string
  let store: FaviconStore

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'favicons-'))
    store = new FaviconStore(dir)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('stores by host and looks up any url on that host', () => {
    store.set('https://a.com/deep/page', 'https://a.com/icon.png')
    expect(store.get('https://a.com/other')).toBe('https://a.com/icon.png')
  })

  it('returns null for unknown hosts and unparseable urls', () => {
    expect(store.get('https://nope.com/')).toBeNull()
    expect(store.get('not a url')).toBeNull()
  })

  it('ignores null favicons and non-http(s) pages', () => {
    store.set('https://a.com/', null)
    store.set('about:blank', 'https://x.com/i.png')
    expect(store.get('https://a.com/')).toBeNull()
    expect(store.get('about:blank')).toBeNull()
  })

  it('a newer favicon replaces the old one', () => {
    store.set('https://a.com/', 'old.png')
    store.set('https://a.com/', 'new.png')
    expect(store.get('https://a.com/')).toBe('new.png')
  })

  it('caps at 2000 hosts, dropping the oldest', () => {
    for (let i = 0; i < 2001; i++) store.set(`https://h${i}.com/`, `icon${i}`)
    expect(store.get('https://h0.com/')).toBeNull()
    expect(store.get('https://h1.com/')).toBe('icon1')
    expect(store.get('https://h2000.com/')).toBe('icon2000')
  })

  it('re-setting a host refreshes its cap position', () => {
    store.set('https://keep.com/', 'keep.png')
    for (let i = 0; i < 1999; i++) store.set(`https://h${i}.com/`, `icon${i}`)
    store.set('https://keep.com/', 'keep.png') // refresh: now newest
    store.set('https://newer.com/', 'newer.png') // evicts h0, not keep
    expect(store.get('https://keep.com/')).toBe('keep.png')
    expect(store.get('https://h0.com/')).toBeNull()
  })

  it('persists via flush and reloads', () => {
    store.set('https://a.com/', 'i.png')
    store.flush()
    expect(new FaviconStore(dir).get('https://a.com/')).toBe('i.png')
  })

  it('recovers from a corrupt file', () => {
    fs.writeFileSync(path.join(dir, 'favicons.json'), '{nope')
    const s2 = new FaviconStore(dir)
    expect(s2.get('https://a.com/')).toBeNull()
    expect(fs.existsSync(path.join(dir, 'favicons.json.bad'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/favicons.test.ts`
Expected: FAIL — module `src/main/favicons` not found.

- [ ] **Step 3: Implement `src/main/favicons.ts`**

```ts
import * as path from 'node:path'
import { JsonStore } from './store'

const MAX_HOSTS = 2000

interface FaviconsFile {
  v: 1
  hosts: Record<string, string>
}

// host → favicon URL, insertion-ordered so the cap drops the least recently
// updated hosts. Suggestion rows join on this at search time.
export class FaviconStore {
  private store: JsonStore<FaviconsFile>

  constructor(dir: string) {
    this.store = new JsonStore<FaviconsFile>(path.join(dir, 'favicons.json'), {
      v: 1,
      hosts: {},
    })
  }

  set(pageUrl: string, favicon: string | null): void {
    if (!favicon || !/^https?:\/\//.test(pageUrl)) return
    const host = hostOf(pageUrl)
    if (!host) return
    const next = { ...this.store.get().hosts }
    delete next[host] // re-insert at the end = newest cap position
    next[host] = favicon
    const keys = Object.keys(next)
    for (let i = 0; i < keys.length - MAX_HOSTS; i++) delete next[keys[i]]
    this.store.set({ v: 1, hosts: next })
  }

  get(url: string): string | null {
    const host = hostOf(url)
    return host ? (this.store.get().hosts[host] ?? null) : null
  }

  flush(): void {
    this.store.flush()
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/favicons.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Add the `onPageFavicon` callback to tab-manager**

In `src/main/tab-manager.ts`, in the opts interface next to `onBookmarkFavicon` (line 25), add:

```ts
  onPageFavicon(url: string, favicon: string | null): void
```

In the `page-favicon-updated` handler (lines 672-676), add one line after the `onBookmarkFavicon` call:

```ts
    wc.on('page-favicon-updated', (_e, favicons) => {
      this.favicons.set(id, favicons[0] ?? null)
      const bid = this.bookmarkIdOf(id)
      if (bid) this.opts.onBookmarkFavicon(bid, favicons[0] ?? null)
      this.opts.onPageFavicon(wc.getURL(), favicons[0] ?? null)
      this.refresh()
    })
```

- [ ] **Step 6: Wire the store in `src/main/index.ts`**

Add import: `import { FaviconStore } from './favicons'`.

After `const history = new HistoryStore(userData)` (line 80):

```ts
  const favicons = new FaviconStore(userData)
```

In the TabManager opts (next to `onNavigated`, ~line 133):

```ts
    onPageFavicon: (url, favicon) => favicons.set(url, favicon),
```

Replace the `history:search` handler (~line 310) with:

```ts
  ipcMain.handle('history:search', (_e, q: string) => {
    const profile = tabs.activeId ? tabs.profileOf(tabs.activeId) : 'default'
    const marks = bookmarks.ordered().filter((b) => (b.profile ?? 'default') === profile)
    return searchSuggestions(history.entries(), marks, String(q), Date.now()).map((s) =>
      s.favicon ? s : { ...s, favicon: favicons.get(s.url) },
    )
  })
```

Next to `history.flush()` (~line 688) add:

```ts
    favicons.flush()
```

- [ ] **Step 7: Verify**

Run: `npx vitest run`
Expected: all tests pass.

Run: `npm run typecheck`
Expected: only `src/renderer/topbar.ts` errors remain (Task 3).

- [ ] **Step 8: Commit**

```bash
git add src/main/favicons.ts tests/favicons.test.ts src/main/tab-manager.ts src/main/index.ts
git commit -m "feat: per-host favicon store joined into urlbar suggestions"
```

---

### Task 3: Renderer — inline autofill + rich dropdown rows

**Files:**
- Modify: `src/renderer/icons.ts` (add `ICON_GLOBE`)
- Modify: `src/renderer/topbar.ts` (autofill mechanics, row rendering, highlighting)
- Modify: `src/renderer/style.css` (row layout, icon, star, bold)

No unit tests — Electron-coupled; verified by typecheck now and manual smoke in Task 4.

**Interfaces:**
- Consumes: `Suggestion` and `stripUrl` from Task 1; `window.synapse.history.search(q): Promise<Suggestion[]>`.
- Produces: n/a (leaf UI).

- [ ] **Step 1: Add `ICON_GLOBE` to `src/renderer/icons.ts`**

```ts
export const ICON_GLOBE = svg(
  '<circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="2.6" ry="6"/><path d="M2.3 6h11.4M2.3 10h11.4"/>',
)
```

- [ ] **Step 2: Rework `src/renderer/topbar.ts` suggestion logic**

Change the imports (line 1-2):

```ts
import type { Suggestion, TabsSnapshot } from '../shared/ipc'
import { stripUrl } from '../shared/history-search'
import { ICON_BACK, ICON_FORWARD, ICON_GLOBE, ICON_RELOAD, ICON_STOP } from './icons'
```

Change the suggestion state (lines 61-62):

```ts
  let suggestions: Suggestion[] = []
  let selected = -1
  let autoSelected = false // row 0 highlighted by inline autofill, not by the user
  let lastQuery = ''
```

Replace `hideSuggestions` (lines 107-113):

```ts
  function hideSuggestions(): void {
    suggestions = []
    selected = -1
    autoSelected = false
    suggestionsEl.hidden = true
    suggestionsEl.innerHTML = ''
    setOverlay(0)
  }
```

Replace `renderSuggestions` (lines 115-136) with the rich rows:

```ts
  // wrap each query token's first match in <b>, building text nodes only —
  // titles and urls are page-controlled strings
  function highlightInto(parent: HTMLElement, text: string, tokens: string[]): void {
    const lower = text.toLowerCase()
    const ranges: [number, number][] = []
    for (const t of tokens) {
      const i = lower.indexOf(t)
      if (i !== -1) ranges.push([i, i + t.length])
    }
    ranges.sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = []
    for (const r of ranges) {
      const last = merged[merged.length - 1]
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
      else merged.push([r[0], r[1]])
    }
    let pos = 0
    for (const [start, end] of merged) {
      if (start > pos) parent.append(text.slice(pos, start))
      const b = document.createElement('b')
      b.textContent = text.slice(start, end)
      parent.append(b)
      pos = end
    }
    parent.append(text.slice(pos))
  }

  function renderSuggestions(): void {
    suggestionsEl.innerHTML = ''
    const tokens = lastQuery.toLowerCase().split(/\s+/).filter(Boolean)
    suggestions.forEach((s, i) => {
      const item = document.createElement('div')
      item.className = 'suggestion' + (i === selected ? ' selected' : '')

      const icon = document.createElement('span')
      icon.className = 'suggestion-icon'
      if (s.favicon) {
        const img = document.createElement('img')
        img.onerror = () => {
          icon.innerHTML = ICON_GLOBE
        }
        img.src = s.favicon
        icon.append(img)
      } else {
        icon.innerHTML = ICON_GLOBE
      }

      const text = document.createElement('span')
      text.className = 'suggestion-text'
      const title = document.createElement('span')
      title.className = 'suggestion-title'
      highlightInto(title, s.title, tokens)
      if (s.isBookmark) {
        const star = document.createElement('span')
        star.className = 'suggestion-star'
        star.textContent = '★'
        title.append(star)
      }
      const url = document.createElement('span')
      url.className = 'suggestion-url'
      highlightInto(url, stripUrl(s.url), tokens)
      text.append(title, url)

      item.append(icon, text)
      // mousedown, not click: it fires before the input's blur hides the dropdown
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        pick(i)
      })
      suggestionsEl.append(item)
    })
    suggestionsEl.hidden = suggestions.length === 0
    setOverlay(suggestionsEl.hidden ? 0 : suggestionsEl.offsetHeight + 4)
  }
```

Replace the `input` listener (lines 155-166):

```ts
  urlbar.addEventListener('input', async (e) => {
    const deletion = e instanceof InputEvent && !!e.inputType?.startsWith('delete')
    const q = urlbar.value.trim()
    if (!q) {
      hideSuggestions()
      return
    }
    const results = await window.synapse.history.search(q)
    if (urlbar.value.trim() !== q || document.activeElement !== urlbar) return // stale response
    suggestions = results
    lastQuery = q
    selected = -1
    autoSelected = false
    const auto = results[0]?.autocomplete
    // inline autofill: complete in place with the remainder selected — but
    // never while deleting, or backspace would fight the user
    if (
      auto &&
      !deletion &&
      urlbar.value === q &&
      auto.toLowerCase().startsWith(q.toLowerCase()) &&
      auto.length > q.length
    ) {
      urlbar.value = q + auto.slice(q.length)
      urlbar.setSelectionRange(q.length, urlbar.value.length)
      selected = 0
      autoSelected = true
    }
    renderSuggestions()
  })
```

Replace the `keydown` listener (lines 184-210). Arrow keys clear `autoSelected` (the user now owns the selection); Escape reverts an active autofill to the typed prefix; Enter treats an auto-selected row as bar text, not a pick:

```ts
  urlbar.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault()
      selected = (selected + 1) % suggestions.length
      autoSelected = false
      renderSuggestions()
      applySelection()
    } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault()
      selected = (selected - 1 + suggestions.length) % suggestions.length
      autoSelected = false
      renderSuggestions()
      applySelection()
    } else if (e.key === 'Escape') {
      // an autofilled remainder the user never asked to keep goes away with the dropdown
      const start = urlbar.selectionStart
      if (autoSelected && start !== null && urlbar.selectionEnd === urlbar.value.length)
        urlbar.value = urlbar.value.slice(0, start)
      hideSuggestions()
    } else if (e.key === 'Enter' && activeId && urlbar.value.trim()) {
      const userPicked = selected >= 0 && !autoSelected
      if (e.altKey) {
        window.synapse.tabs.create(userPicked ? suggestions[selected].url : urlbar.value)
        urlbar.blur()
        hideSuggestions()
      } else if (userPicked) {
        pick(selected)
      } else {
        // autofilled text goes through classifyInput in main, so
        // "feedback.limitless.ai/" loads https://feedback.limitless.ai/
        window.synapse.tabs.navigate(activeId, urlbar.value)
        urlbar.blur()
        hideSuggestions()
      }
    }
  })
```

- [ ] **Step 3: Update `src/renderer/style.css`**

Replace the `.suggestion` block (lines 386-392) with:

```css
.suggestion {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background var(--t-fast);
}
```

After the `.suggestion-url` block (ends line 409) add:

```css
.suggestion-icon {
  flex: none;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-dim);
}
.suggestion-icon img {
  width: 16px;
  height: 16px;
  border-radius: 3px;
}
.suggestion-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.suggestion-title b,
.suggestion-url b {
  font-weight: 700;
}
.suggestion-url b {
  color: var(--fg);
}
.suggestion-star {
  margin-left: 6px;
  font-size: 11px;
  color: var(--fg-dim);
}
```

Check the variables used (`--fg`, `--fg-dim`, `--t-fast`) exist in `:root` at the top of `style.css`; if a name differs, use the file's actual token (e.g. some codebases use `--text-dim`). Do not invent new variables.

- [ ] **Step 4: Typecheck + full test run**

Run: `npm run typecheck`
Expected: clean.

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/icons.ts src/renderer/topbar.ts src/renderer/style.css
git commit -m "feat: inline urlbar autofill + favicon/highlight suggestion rows"
```

---

### Task 4: Runtime verification + review

**Files:** none new — fixes land where findings point.

- [ ] **Step 1: Manual smoke via the `verify` skill (dev instance)**

Launch per the skill's harness (fresh `SYNAPSE_USER_DATA`; remember the profile inherits real bookmarks via legacy migration — seed deliberately). Script:

1. Visit `https://example.com` and one deep URL (e.g. `https://en.wikipedia.org/wiki/Frecency`), let them finish loading (history + favicons captured).
2. Focus urlbar (Cmd+L), type `ex` → bar should read `example.com/` with `ample.com/` selected; row 0 pre-highlighted with favicon.
3. Press Enter → loads `https://example.com/`.
4. Type `exa`, press Backspace twice → text actually shrinks, no re-completion fight.
5. Type `wiki frec` (multi-word) → Wikipedia row appears via title+URL token match, matched substrings bold, no inline autofill.
6. Bookmark a page, search its bookmark name → row shows ★.
7. Escape with autofill active → remainder removed, dropdown closed, overlay reset (click the page to confirm it isn't shifted).
8. ArrowDown through rows → bar shows each row's full URL (existing behavior preserved).

- [ ] **Step 2: Code review**

Invoke the `code-review` skill (effort: high) over the branch diff; triage and fix confirmed findings; re-run `npx vitest run` + `npm run typecheck` after fixes.

- [ ] **Step 3: Final commit (if fixes were made)**

```bash
git add -A && git commit -m "fix: urlbar autocomplete review findings"
```
