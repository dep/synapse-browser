# New Tab Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chrome-rendered new-tab page (clock, weather, top-10 sites, searchable title-deduped history) shown whenever the active tab is blank.

**Architecture:** The chrome UI renderer draws the page in the page cell exactly like the settings screen: when the active tab is blank, `TabManager.syncViews()` attaches no `WebContentsView`. Data flows over two new invokes (`newtab:data` fast, `newtab:weather` slow); all ranking/dedupe/grouping logic is pure and lives in `src/shared/newtab.ts` with Vitest coverage. Weather is fetched in main (ip-api → Open-Meteo) and cached 30 min.

**Tech Stack:** Electron + electron-vite, TypeScript strict, no UI framework, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-new-tab-page-design.md`

## Global Constraints

- TypeScript strict; no new runtime npm dependencies.
- Pure logic goes in Electron-free modules under `src/shared/` with Vitest tests in `tests/`.
- Never register `session.webRequest` or `protocol.intercept*` handlers (extensions hazard) — this plan adds neither.
- Web page tabs keep zero IPC exposure; only the chrome UI preload changes.
- Short conventional commits (`feat:`, `fix:`, `chore:`).
- `npm run typecheck` and `npm test` must pass before any task is called done.
- Renderer holds no tab state: new-tab visibility is derived per `tabs:updated` snapshot.

---

### Task 1: Shared pure helpers (`src/shared/newtab.ts`)

**Files:**
- Create: `src/shared/newtab.ts`
- Create: `tests/newtab.test.ts`
- Modify: `src/shared/history-search.ts:49` (export `visitWeight`)

**Interfaces:**
- Consumes: `HistoryEntry` from `src/shared/ipc.ts`; `queryTokens`, `stripUrl`, `visitWeight` from `src/shared/history-search.ts`.
- Produces (used by Tasks 4, 5, 6):
  - `isBlankUrl(url: string): boolean`
  - `hostOf(url: string): string | null`
  - `topSitesFrom(entries: HistoryEntry[], now: number, limit = 10): TopSite[]`
  - `dedupeByTitle(entries: HistoryEntry[]): HistoryEntry[]`
  - `dayLabel(visitedAt: number, now: number): string`
  - `filterEntries(entries: HistoryEntry[], query: string): HistoryEntry[]`
  - `weatherGlyph(code: number): string`
  - `formatTemp(tempC: number, useFahrenheit: boolean): string`

**Note:** `TopSite` is a shared IPC type, so Task 1 adds it to `src/shared/ipc.ts` directly (Step 2); Task 2 adds the remaining IPC types around it. This avoids a forward dependency between the tasks.

- [ ] **Step 1: Export `visitWeight` from history-search**

In `src/shared/history-search.ts`, change line 49 from `function visitWeight(` to:

```ts
export function visitWeight(age: number): number {
```

- [ ] **Step 2: Add `TopSite` to `src/shared/ipc.ts`**

After the `HistoryEntry` interface (line 40-44), add:

```ts
export interface TopSite {
  host: string
  url: string
}
```

- [ ] **Step 3: Write the failing tests**

Create `tests/newtab.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../src/shared/ipc'
import {
  dayLabel,
  dedupeByTitle,
  filterEntries,
  formatTemp,
  hostOf,
  isBlankUrl,
  topSitesFrom,
  weatherGlyph,
} from '../src/shared/newtab'

const DAY = 86_400_000
// local noon anchor keeps day-boundary math away from timezone edges
const NOON = new Date(2026, 6, 15, 12, 0, 0).getTime()

const e = (url: string, title: string, visitedAt: number): HistoryEntry => ({
  url,
  title,
  visitedAt,
})

describe('isBlankUrl', () => {
  it('treats empty and about:blank as blank', () => {
    expect(isBlankUrl('')).toBe(true)
    expect(isBlankUrl('about:blank')).toBe(true)
    expect(isBlankUrl('https://a.com')).toBe(false)
  })
})

describe('hostOf', () => {
  it('extracts the host including port', () => {
    expect(hostOf('https://a.com/x/y')).toBe('a.com')
    expect(hostOf('http://localhost:3000/p')).toBe('localhost:3000')
  })
  it('returns null for unparseable urls', () => {
    expect(hostOf('not a url')).toBe(null)
  })
})

describe('topSitesFrom', () => {
  it('ranks hosts by frecency-weighted visit totals', () => {
    const entries = [
      e('https://a.com/', 'A', NOON - 1 * DAY),
      e('https://a.com/', 'A', NOON - 2 * DAY),
      e('https://b.com/', 'B', NOON - 1 * DAY),
    ]
    const sites = topSitesFrom(entries, NOON)
    expect(sites.map((s) => s.host)).toEqual(['a.com', 'b.com'])
  })

  it('weights recent visits above many ancient ones', () => {
    const entries = [
      // 3 visits ~200 days old (weight 10 each = 30)
      e('https://old.com/', 'Old', NOON - 200 * DAY),
      e('https://old.com/', 'Old', NOON - 201 * DAY),
      e('https://old.com/', 'Old', NOON - 202 * DAY),
      // 1 visit today (weight 100)
      e('https://fresh.com/', 'Fresh', NOON - 1000),
    ]
    expect(topSitesFrom(entries, NOON)[0].host).toBe('fresh.com')
  })

  it("picks the host's most-visited url, ties broken by recency", () => {
    const entries = [
      e('https://a.com/hot', 'Hot', NOON - 1 * DAY),
      e('https://a.com/hot', 'Hot', NOON - 2 * DAY),
      e('https://a.com/cold', 'Cold', NOON - 3 * DAY),
      e('https://b.com/new', 'New', NOON - 1 * DAY),
      e('https://b.com/older', 'Older', NOON - 2 * DAY),
    ]
    const sites = topSitesFrom(entries, NOON)
    expect(sites.find((s) => s.host === 'a.com')?.url).toBe('https://a.com/hot')
    expect(sites.find((s) => s.host === 'b.com')?.url).toBe('https://b.com/new')
  })

  it('caps at the limit and skips unparseable urls', () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      e(`https://site${i}.com/`, `S${i}`, NOON - i * 1000),
    )
    expect(topSitesFrom(entries, NOON).length).toBe(10)
    expect(topSitesFrom([e('nonsense', 'X', NOON)], NOON)).toEqual([])
  })
})

describe('dedupeByTitle', () => {
  it('keeps only the first (newest) entry per title', () => {
    const entries = [
      e('https://a.com/1', 'Same Title', NOON),
      e('https://a.com/2', 'Same Title', NOON - 1000),
      e('https://a.com/3', 'Other', NOON - 2000),
    ]
    expect(dedupeByTitle(entries).map((x) => x.url)).toEqual([
      'https://a.com/1',
      'https://a.com/3',
    ])
  })

  it('dedupes untitled entries by url instead', () => {
    const entries = [
      e('https://a.com/', '', NOON),
      e('https://a.com/', '', NOON - 1000),
      e('https://b.com/', '', NOON - 2000),
    ]
    expect(dedupeByTitle(entries).map((x) => x.url)).toEqual([
      'https://a.com/',
      'https://b.com/',
    ])
  })
})

describe('dayLabel', () => {
  it('labels today and yesterday', () => {
    expect(dayLabel(NOON - 1000, NOON)).toBe('Today')
    expect(dayLabel(NOON - DAY, NOON)).toBe('Yesterday')
  })
  it('labels older days with a dated label', () => {
    const label = dayLabel(NOON - 5 * DAY, NOON)
    expect(label).not.toBe('Today')
    expect(label).not.toBe('Yesterday')
    expect(label).toMatch(/\d/)
  })
})

describe('filterEntries', () => {
  const entries = [
    e('https://github.com/foo', 'GitHub - foo repo', NOON),
    e('https://news.ycombinator.com/', 'Hacker News', NOON - 1000),
  ]
  it('matches tokens against the title', () => {
    expect(filterEntries(entries, 'hacker').map((x) => x.url)).toEqual([
      'https://news.ycombinator.com/',
    ])
  })
  it('matches tokens against the scheme-stripped url', () => {
    expect(filterEntries(entries, 'github.com/foo').length).toBe(1)
  })
  it('requires every token to match', () => {
    expect(filterEntries(entries, 'github news').length).toBe(0)
    expect(filterEntries(entries, 'github repo').length).toBe(1)
  })
  it('returns everything for an empty query', () => {
    expect(filterEntries(entries, '  ').length).toBe(2)
  })
})

describe('weatherGlyph', () => {
  it('maps WMO weather codes to glyphs', () => {
    expect(weatherGlyph(0)).toBe('☀️')
    expect(weatherGlyph(2)).toBe('🌤️')
    expect(weatherGlyph(3)).toBe('☁️')
    expect(weatherGlyph(45)).toBe('🌫️')
    expect(weatherGlyph(53)).toBe('🌦️')
    expect(weatherGlyph(63)).toBe('🌧️')
    expect(weatherGlyph(81)).toBe('🌧️')
    expect(weatherGlyph(73)).toBe('🌨️')
    expect(weatherGlyph(86)).toBe('🌨️')
    expect(weatherGlyph(95)).toBe('⛈️')
  })
})

describe('formatTemp', () => {
  it('rounds celsius and converts to fahrenheit', () => {
    expect(formatTemp(20.4, false)).toBe('20°')
    expect(formatTemp(20, true)).toBe('68°')
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/newtab.test.ts`
Expected: FAIL — cannot resolve `../src/shared/newtab`.

- [ ] **Step 5: Implement `src/shared/newtab.ts`**

```ts
import { queryTokens, stripUrl, visitWeight } from './history-search'
import type { HistoryEntry, TopSite } from './ipc'

// a view that never had loadURL called reports '', an explicit blank load
// reports 'about:blank'; both mean "show the new-tab page"
export function isBlankUrl(url: string): boolean {
  return url === '' || url === 'about:blank'
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

// rank hosts by frecency-weighted visit totals; a host's tile opens its
// most-visited URL (ties → most recently visited)
export function topSitesFrom(entries: HistoryEntry[], now: number, limit = 10): TopSite[] {
  interface HostAgg {
    score: number
    urls: Map<string, { count: number; last: number }>
  }
  const hosts = new Map<string, HostAgg>()
  for (const entry of entries) {
    const host = hostOf(entry.url)
    if (!host) continue
    let agg = hosts.get(host)
    if (!agg) {
      agg = { score: 0, urls: new Map() }
      hosts.set(host, agg)
    }
    agg.score += visitWeight(now - entry.visitedAt)
    const u = agg.urls.get(entry.url) ?? { count: 0, last: 0 }
    u.count += 1
    u.last = Math.max(u.last, entry.visitedAt)
    agg.urls.set(entry.url, u)
  }
  return [...hosts.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([host, agg]) => {
      const [url] = [...agg.urls.entries()].sort(
        (a, b) => b[1].count - a[1].count || b[1].last - a[1].last,
      )[0]
      return { host, url }
    })
}

// newest-first scan keeps the first occurrence per title; untitled entries
// dedupe by URL instead
export function dedupeByTitle(entries: HistoryEntry[]): HistoryEntry[] {
  const seen = new Set<string>()
  const out: HistoryEntry[] = []
  for (const entry of entries) {
    const key = entry.title ? `t:${entry.title}` : `u:${entry.url}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

// local-midnight day boundaries; the renderer streams rows and inserts a
// header whenever this label changes
export function dayLabel(visitedAt: number, now: number): string {
  const startOfDay = (t: number) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime()
  const day = startOfDay(visitedAt)
  const today = startOfDay(now)
  if (day === today) return 'Today'
  if (day === startOfDay(today - 1)) return 'Yesterday'
  return new Date(day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
}

// every token must appear in title or scheme/www-stripped url (same
// normalization the urlbar suggestions use)
export function filterEntries(entries: HistoryEntry[], query: string): HistoryEntry[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return entries
  return entries.filter((entry) => {
    const hay = `${entry.title} ${stripUrl(entry.url)}`.toLowerCase()
    return tokens.every((t) => hay.includes(t))
  })
}

// WMO weather interpretation codes (Open-Meteo `weathercode`)
export function weatherGlyph(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code === 45 || code === 48) return '🌫️'
  if (code >= 51 && code <= 57) return '🌦️'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return '🌧️'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '🌨️'
  if (code >= 95) return '⛈️'
  return '🌡️'
}

export function formatTemp(tempC: number, useFahrenheit: boolean): string {
  const t = useFahrenheit ? (tempC * 9) / 5 + 32 : tempC
  return `${Math.round(t)}°`
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/newtab.test.ts`
Expected: PASS (all suites).

Also run the full suite + typecheck: `npm test` and `npm run typecheck`
Expected: PASS (exporting `visitWeight` breaks nothing).

- [ ] **Step 7: Commit**

```bash
git add src/shared/newtab.ts src/shared/history-search.ts src/shared/ipc.ts tests/newtab.test.ts
git commit -m "feat: new-tab pure helpers (top sites, dedupe, day labels, weather glyphs)"
```

---

### Task 2: IPC surface — types, preload, favicon map

**Files:**
- Modify: `src/shared/ipc.ts` (add `WeatherInfo`, `NewTabData`, `SynapseApi.newtab`)
- Modify: `src/preload/index.ts` (expose `newtab`)
- Modify: `src/main/favicons.ts` (add `all()`)
- Test: `tests/favicons.test.ts` (extend)

**Interfaces:**
- Consumes: `TopSite`, `HistoryEntry` from Task 1's ipc.ts additions.
- Produces (used by Tasks 3, 4, 6):
  - `WeatherInfo { tempC: number; code: number; city: string; useFahrenheit: boolean }`
  - `NewTabData { entries: HistoryEntry[]; topSites: TopSite[]; favicons: Record<string, string>; weather: WeatherInfo | null }`
  - `window.synapse.newtab.data(): Promise<NewTabData>` → invoke `newtab:data`
  - `window.synapse.newtab.weather(): Promise<WeatherInfo | null>` → invoke `newtab:weather`
  - `FaviconStore.all(): Record<string, string>` (host → favicon URL)

- [ ] **Step 1: Write the failing test for `FaviconStore.all()`**

`tests/favicons.test.ts` already has a `describe('FaviconStore')` block with `beforeEach` creating `store` against a temp dir. Append inside that describe block:

```ts
  it('all() returns the host → favicon map', () => {
    store.set('https://a.com/page', 'https://a.com/icon.png')
    store.set('https://b.com/x', 'https://b.com/fav.ico')
    expect(store.all()).toEqual({
      'a.com': 'https://a.com/icon.png',
      'b.com': 'https://b.com/fav.ico',
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/favicons.test.ts`
Expected: FAIL — `all` is not a function.

- [ ] **Step 3: Implement `all()` in `src/main/favicons.ts`**

Add after the `get` method:

```ts
  all(): Record<string, string> {
    return this.store.get().hosts
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/favicons.test.ts`
Expected: PASS.

- [ ] **Step 5: Add IPC types to `src/shared/ipc.ts`**

After the `TopSite` interface (added in Task 1), add:

```ts
export interface WeatherInfo {
  tempC: number
  code: number
  city: string
  useFahrenheit: boolean
}

export interface NewTabData {
  entries: HistoryEntry[] // full history, newest first
  topSites: TopSite[]
  favicons: Record<string, string> // host → favicon URL
  weather: WeatherInfo | null // cached only; newtab.weather() fetches fresh
}
```

In `SynapseApi`, after the `history` block (lines 105-108), add:

```ts
  newtab: {
    data(): Promise<NewTabData>
    weather(): Promise<WeatherInfo | null>
  }
```

- [ ] **Step 6: Expose in `src/preload/index.ts`**

After the `history` block (lines 21-24), add:

```ts
  newtab: {
    data: () => ipcRenderer.invoke('newtab:data'),
    weather: () => ipcRenderer.invoke('newtab:weather'),
  },
```

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS (handlers don't exist yet, but IPC channels are stringly-typed — nothing references the missing handlers at compile time).

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/favicons.ts tests/favicons.test.ts
git commit -m "feat: new-tab IPC surface (types, preload, favicon map)"
```

---

### Task 3: Weather service (`src/main/weather.ts`)

**Files:**
- Create: `src/main/weather.ts`

**Interfaces:**
- Consumes: `WeatherInfo` from `src/shared/ipc.ts` (Task 2); Electron `net`.
- Produces (used by Task 4):
  - `class WeatherService` with `cached(): WeatherInfo | null` (never fetches) and `get(): Promise<WeatherInfo | null>` (fetches when stale; never rejects).

This module is Electron-coupled (`net`), so per repo convention it is verified by manual smoke in Task 7, not unit tests. The pure pieces (glyph map, temp formatting) were tested in Task 1.

- [ ] **Step 1: Implement `src/main/weather.ts`**

```ts
import { net } from 'electron'
import type { WeatherInfo } from '../shared/ipc'

const TTL = 30 * 60_000
const NEG_TTL = 5 * 60_000 // failure back-off so a dead network isn't hammered
// countries reporting in Fahrenheit
const F_COUNTRIES = new Set(['US', 'BS', 'BZ', 'KY', 'PW'])

// IP geolocation → Open-Meteo current conditions. No API keys. Failures are
// swallowed: the new-tab page simply omits the weather line.
export class WeatherService {
  private value: WeatherInfo | null = null
  private fetchedAt = 0
  private failedAt = 0
  private inflight: Promise<WeatherInfo | null> | null = null

  cached(): WeatherInfo | null {
    return Date.now() - this.fetchedAt <= TTL ? this.value : null
  }

  async get(): Promise<WeatherInfo | null> {
    const cached = this.cached()
    if (cached) return cached
    if (Date.now() - this.failedAt <= NEG_TTL) return null
    this.inflight ??= this.fetch()
      .catch(() => null)
      .then((v) => {
        if (v) {
          this.value = v
          this.fetchedAt = Date.now()
        } else {
          this.failedAt = Date.now()
        }
        this.inflight = null
        return v
      })
    return this.inflight
  }

  private async fetch(): Promise<WeatherInfo | null> {
    const geoRes = await net.fetch(
      'http://ip-api.com/json/?fields=status,lat,lon,city,countryCode',
    )
    const geo = (await geoRes.json()) as {
      status?: string
      lat?: number
      lon?: number
      city?: string
      countryCode?: string
    }
    if (geo.status !== 'success' || typeof geo.lat !== 'number' || typeof geo.lon !== 'number')
      return null
    const wxRes = await net.fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current_weather=true`,
    )
    const wx = (await wxRes.json()) as {
      current_weather?: { temperature?: number; weathercode?: number }
    }
    const cw = wx.current_weather
    if (!cw || typeof cw.temperature !== 'number' || typeof cw.weathercode !== 'number')
      return null
    return {
      tempC: cw.temperature,
      code: cw.weathercode,
      city: geo.city ?? '',
      useFahrenheit: F_COUNTRIES.has(geo.countryCode ?? ''),
    }
  }
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/main/weather.ts
git commit -m "feat: ip-geolocated Open-Meteo weather service with 30-min cache"
```

---

### Task 4: Main-process handlers (`newtab:data`, `newtab:weather`)

**Files:**
- Modify: `src/main/index.ts` (instantiate `WeatherService`, register both handlers next to the history handlers at lines 313-320)

**Interfaces:**
- Consumes: `topSitesFrom` (Task 1), `FaviconStore.all()` (Task 2), `WeatherService` (Task 3), existing `history.entries()`.
- Produces: live `newtab:data` / `newtab:weather` invoke channels matching the preload from Task 2.

- [ ] **Step 1: Add imports to `src/main/index.ts`**

Alongside the existing imports (near `import { searchSuggestions } from '../shared/history-search'` at line 15):

```ts
import { topSitesFrom } from '../shared/newtab'
import { WeatherService } from './weather'
```

- [ ] **Step 2: Instantiate the service**

Next to the store instantiations (after `const settingsStore = new SettingsStore(userData)` at line 89):

```ts
const weather = new WeatherService()
```

- [ ] **Step 3: Register handlers**

Immediately after `ipcMain.handle('history:list', () => history.list())` (line 320):

```ts
  ipcMain.handle('newtab:data', () => {
    const entries = history.entries()
    return {
      entries,
      topSites: topSitesFrom(entries, Date.now()),
      favicons: favicons.all(),
      weather: weather.cached(),
    }
  })
  ipcMain.handle('newtab:weather', () => weather.get())
```

- [ ] **Step 4: Typecheck and commit**

Run: `npm run typecheck` and `npm test`
Expected: PASS.

```bash
git add src/main/index.ts
git commit -m "feat: newtab:data and newtab:weather IPC handlers"
```

---

### Task 5: Blank tabs attach no page view

**Files:**
- Modify: `src/main/tab-manager.ts` (`syncViews()` at lines 607-633; `did-start-loading` handler at line ~667)

**Interfaces:**
- Consumes: `isBlankUrl` from `src/shared/newtab.ts` (Task 1).
- Produces: main-process behavior Task 6's renderer relies on — a blank active tab leaves the page cell empty, and navigation re-attaches the view.

**Why `did-start-loading` must call `syncViews()`:** a blank tab's view is detached, and `refresh()` alone only emits a snapshot — nothing would ever re-attach the view when the tab navigates. `syncViews()` reaps dead views, reconciles attachment, lays out, and ends with `refresh()`, and it is idempotent, so it is a strict superset of the old handler.

- [ ] **Step 1: Import the predicate**

In `src/main/tab-manager.ts`, add to the existing shared imports:

```ts
import { isBlankUrl } from '../shared/newtab'
```

- [ ] **Step 2: Skip attaching blank views in `syncViews()`**

Replace (lines 617-620):

```ts
    const active =
      !this.settingsOpen && this.model.activeId
        ? (this.views.get(this.model.activeId) ?? null)
        : null
```

with:

```ts
    // a blank active tab attaches no view, leaving the chrome renderer's
    // new-tab page visible in the page cell (same mechanism as settings)
    const activeView =
      !this.settingsOpen && this.model.activeId
        ? (this.views.get(this.model.activeId) ?? null)
        : null
    const active =
      activeView && !isBlankUrl(activeView.webContents.getURL()) ? activeView : null
```

- [ ] **Step 3: Re-attach on navigation**

In `wireEvents()`, replace:

```ts
    wc.on('did-start-loading', refresh)
```

with:

```ts
    // a blank (detached) tab that starts navigating must get its view
    // attached; syncViews ends with refresh(), so this is a superset
    wc.on('did-start-loading', () => this.syncViews())
```

- [ ] **Step 4: Typecheck, test, and commit**

Run: `npm run typecheck` and `npm test`
Expected: PASS (tab-model tests are pure and untouched; `tab-manager` has no unit tests).

Quick manual sanity (optional here, full smoke in Task 7): `npm run dev` — a new tab shows the empty dark canvas well (no white `about:blank` page); typing a URL loads and displays the page.

```bash
git add src/main/tab-manager.ts
git commit -m "feat: blank tabs attach no page view, freeing the page cell"
```

---

### Task 6: Renderer — the new-tab page itself

**Files:**
- Create: `src/renderer/newtab.ts`
- Modify: `src/renderer/index.html` (add `<main id="newtab" hidden></main>` after `<main id="settings" hidden></main>` at line 50)
- Modify: `src/renderer/main.ts` (wire controller + track settings state)
- Modify: `src/renderer/style.css` (append `.newtab-*` rules)

**Interfaces:**
- Consumes: `window.synapse.newtab.*` (Tasks 2/4), `window.synapse.tabs.navigate`, shared helpers (Task 1), snapshot flow in `main.ts`.
- Produces: `initNewTab(el: HTMLElement): { update(snap: TabsSnapshot, settingsOpen: boolean): void }`.

- [ ] **Step 1: Add the host element**

In `src/renderer/index.html`, after `<main id="settings" hidden></main>`:

```html
      <main id="newtab" hidden></main>
```

- [ ] **Step 2: Implement `src/renderer/newtab.ts`**

```ts
import type { HistoryEntry, NewTabData, TabsSnapshot, WeatherInfo } from '../shared/ipc'
import {
  dayLabel,
  dedupeByTitle,
  filterEntries,
  formatTemp,
  hostOf,
  isBlankUrl,
  weatherGlyph,
} from '../shared/newtab'

const PAGE_SIZE = 100

export interface NewTabController {
  update(snap: TabsSnapshot, settingsOpen: boolean): void
}

export function initNewTab(el: HTMLElement): NewTabController {
  const well = document.createElement('div')
  well.className = 'newtab-well'
  const column = document.createElement('div')
  column.className = 'newtab-column'
  const clockEl = document.createElement('div')
  clockEl.className = 'newtab-clock'
  const dateEl = document.createElement('div')
  dateEl.className = 'newtab-date'
  const weatherEl = document.createElement('div')
  weatherEl.className = 'newtab-weather'
  weatherEl.hidden = true
  const tilesEl = document.createElement('div')
  tilesEl.className = 'newtab-tiles'
  const searchEl = document.createElement('input')
  searchEl.className = 'newtab-search'
  searchEl.type = 'text'
  searchEl.placeholder = 'Search history…'
  searchEl.spellcheck = false
  const listEl = document.createElement('div')
  listEl.className = 'newtab-list'
  const sentinel = document.createElement('div')
  sentinel.className = 'newtab-sentinel'
  column.append(clockEl, dateEl, weatherEl, tilesEl, searchEl, listEl, sentinel)
  well.append(column)
  el.append(well)

  let visible = false
  let activeId: string | null = null
  let data: NewTabData | null = null
  let deduped: HistoryEntry[] = []
  let rendered = 0
  let lastLabel = ''
  let timer: ReturnType<typeof setInterval> | undefined

  const navigate = (url: string): void => {
    if (activeId) window.synapse.tabs.navigate(activeId, url)
  }

  const tickClock = (): void => {
    const now = new Date()
    clockEl.textContent = now.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
  }

  const iconFor = (url: string): HTMLElement => {
    const host = hostOf(url)
    const fav = host ? data?.favicons[host] : undefined
    if (fav) {
      const img = document.createElement('img')
      img.className = 'newtab-icon'
      img.src = fav
      return img
    }
    const mono = document.createElement('div')
    mono.className = 'newtab-icon newtab-monogram'
    mono.textContent = (host?.[0] ?? '?').toUpperCase()
    return mono
  }

  const renderWeather = (w: WeatherInfo | null): void => {
    weatherEl.hidden = !w
    if (w) {
      weatherEl.textContent =
        `${weatherGlyph(w.code)} ${formatTemp(w.tempC, w.useFahrenheit)} ${w.city}`.trim()
    }
  }

  const renderTiles = (): void => {
    tilesEl.innerHTML = ''
    const sites = data?.topSites ?? []
    tilesEl.hidden = sites.length === 0
    for (const site of sites) {
      const tile = document.createElement('button')
      tile.className = 'newtab-tile'
      tile.title = site.url
      const label = document.createElement('span')
      label.className = 'newtab-tile-label'
      label.textContent = site.host.replace(/^www\./, '')
      tile.append(iconFor(site.url), label)
      tile.addEventListener('click', () => navigate(site.url))
      tilesEl.append(tile)
    }
  }

  const currentList = (): HistoryEntry[] =>
    searchEl.value.trim() ? filterEntries(deduped, searchEl.value) : deduped

  const appendRows = (): void => {
    const list = currentList()
    const searching = !!searchEl.value.trim()
    const now = Date.now()
    for (const entry of list.slice(rendered, rendered + PAGE_SIZE)) {
      if (!searching) {
        const label = dayLabel(entry.visitedAt, now)
        if (label !== lastLabel) {
          lastLabel = label
          const heading = document.createElement('div')
          heading.className = 'newtab-heading'
          heading.textContent = label
          listEl.append(heading)
        }
      }
      const row = document.createElement('button')
      row.className = 'newtab-row'
      const title = document.createElement('span')
      title.className = 'newtab-row-title'
      title.textContent = entry.title || entry.url
      const host = document.createElement('span')
      host.className = 'newtab-row-host'
      host.textContent = hostOf(entry.url) ?? ''
      const time = document.createElement('span')
      time.className = 'newtab-row-time'
      time.textContent = new Date(entry.visitedAt).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })
      row.append(iconFor(entry.url), title, host, time)
      row.addEventListener('click', () => navigate(entry.url))
      listEl.append(row)
    }
    rendered = Math.min(rendered + PAGE_SIZE, list.length)
    sentinel.hidden = rendered >= list.length
  }

  const resetList = (): void => {
    listEl.innerHTML = ''
    rendered = 0
    lastLabel = ''
    searchEl.hidden = deduped.length === 0
    appendRows()
  }

  searchEl.addEventListener('input', resetList)

  // the well is the scroller; when it nears the sentinel, page in more rows
  const io = new IntersectionObserver((es) => {
    if (es.some((x) => x.isIntersecting)) appendRows()
  }, { root: well })
  io.observe(sentinel)

  const load = async (): Promise<void> => {
    data = await window.synapse.newtab.data()
    if (!visible) return
    deduped = dedupeByTitle(data.entries)
    renderTiles()
    resetList()
    renderWeather(data.weather)
    const w = await window.synapse.newtab.weather()
    if (visible) renderWeather(w)
  }

  return {
    update(snap: TabsSnapshot, settingsOpen: boolean): void {
      const active = snap.activeId ? snap.tabs[snap.activeId] : undefined
      activeId = snap.activeId
      const show = !settingsOpen && !!active && isBlankUrl(active.url)
      if (show === visible) return
      visible = show
      el.hidden = !show
      if (show) {
        tickClock()
        timer = setInterval(tickClock, 1000)
        searchEl.value = ''
        void load()
      } else {
        clearInterval(timer)
      }
    },
  }
}
```

- [ ] **Step 3: Wire into `src/renderer/main.ts`**

Add the import:

```ts
import { initNewTab } from './newtab'
```

After `const settingsEl = document.getElementById('settings')!` add:

```ts
const newtab = initNewTab(document.getElementById('newtab')!)
let settingsOpen = false
```

Replace the `onSettings` handler body (lines 62-67):

```ts
window.synapse.ui.onSettings((open) => {
  settingsOpen = open
  findBar.close()
  settingsEl.hidden = !open
  if (open) renderSettings(settingsEl, 'general')
  else cancelRecording()
  render()
})
```

At the end of `render()` (after the `panelEl.hidden = showSidebar` line), add:

```ts
  newtab.update(snap, settingsOpen)
```

- [ ] **Step 4: Append styles to `src/renderer/style.css`**

```css
/* ---- new tab page ---- */
#newtab {
  grid-row: 2;
  grid-column: 2;
  min-width: 0;
  min-height: 0;
  padding: calc(var(--overlay-shift, 0px) + var(--gap, 8px)) var(--gap, 8px) var(--gap, 8px);
}
#newtab[hidden] {
  display: none;
}
.newtab-well {
  height: 100%;
  overflow-y: auto;
  border-radius: var(--canvas-radius, 8px);
  background: var(--well);
  box-shadow:
    0 0 0 1px var(--canvas-ring),
    0 2px 12px rgba(0, 0, 0, 0.35);
}
.newtab-column {
  max-width: 680px;
  margin: 0 auto;
  padding: 48px 24px 32px;
}
.newtab-clock {
  font-size: 64px;
  font-weight: 200;
  letter-spacing: 1px;
  text-align: center;
}
.newtab-date {
  text-align: center;
  color: var(--fg-dim);
  margin-top: 4px;
}
.newtab-weather {
  text-align: center;
  color: var(--fg-dim);
  font-size: 14px;
  margin-top: 12px;
}
.newtab-tiles {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  margin-top: 40px;
}
.newtab-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 4px;
  background: none;
  border: none;
  border-radius: var(--r-m);
  color: var(--fg);
  font: inherit;
  cursor: pointer;
  min-width: 0;
}
.newtab-tile:hover {
  background: rgba(255, 255, 255, 0.05);
}
.newtab-tile .newtab-icon {
  width: 28px;
  height: 28px;
  font-size: 14px;
}
.newtab-icon {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  flex-shrink: 0;
}
.newtab-monogram {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--shell-raised);
  color: var(--fg-dim);
  font-size: 10px;
  font-weight: 600;
}
.newtab-tile-label {
  font-size: 12px;
  color: var(--fg-dim);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.newtab-search {
  display: block;
  width: 100%;
  margin-top: 40px;
  padding: 8px 4px;
  background: none;
  border: none;
  border-bottom: 1px solid var(--line);
  color: var(--fg);
  font: inherit;
  font-size: 14px;
  outline: none;
}
.newtab-search:focus {
  border-bottom-color: var(--focus-ring);
}
.newtab-heading {
  color: var(--fg-dim);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 20px 4px 6px;
}
.newtab-row {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 7px 8px;
  background: none;
  border: none;
  border-radius: var(--r-s);
  color: var(--fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.newtab-row:hover {
  background: rgba(255, 255, 255, 0.04);
}
.newtab-row-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.newtab-row-host,
.newtab-row-time {
  color: var(--fg-dim);
  font-size: 12px;
  white-space: nowrap;
}
.newtab-sentinel {
  height: 1px;
}
```

- [ ] **Step 5: Typecheck, test, and commit**

Run: `npm run typecheck` and `npm test`
Expected: PASS.

```bash
git add src/renderer/newtab.ts src/renderer/index.html src/renderer/main.ts src/renderer/style.css
git commit -m "feat: new-tab page — clock, weather, top sites, searchable history"
```

---

### Task 7: End-to-end verification

**Files:** none (verification only; fix-forward commits if issues surface).

- [ ] **Step 1: Unit + type gates**

Run: `npm test` and `npm run typecheck`
Expected: PASS, zero errors.

- [ ] **Step 2: Runtime smoke via the /verify harness**

Use the repo's `verify` skill (fresh `SYNAPSE_USER_DATA` profile — note it migrates real bookmarks/pins via the legacy-dir copy, so seed history by browsing a few pages first). Checklist:

1. Fresh Cmd+T → new-tab page appears in the page cell: clock ticking, date correct. URL bar has focus.
2. Weather line appears within a few seconds (needs network) with glyph + temp + city; with network unplugged it stays absent and the layout doesn't jump.
3. After visiting several sites: tiles show up to 10 hosts, most-visited first, favicons or monograms render, clicking a tile navigates the current tab (page view attaches, new-tab page disappears).
4. History list: newest first, grouped Today/Yesterday, no two rows share a title, times render, clicking a row navigates.
5. Search: typing filters live (flat list, no day headers), clearing restores groups; scroll to the bottom pages in more rows.
6. Typing a URL in the urlbar from a blank tab loads it — the view attaches (this exercises the `did-start-loading` → `syncViews` path).
7. Settings (⌘,) over a blank tab shows settings, not the new-tab page; closing settings brings the new-tab page back.
8. Ctrl+Tab cycling between a blank tab and a loaded tab attaches/detaches correctly; closing the last tab lands on a fresh blank tab showing the page.
9. Work-profile blank tab: page renders identically (accent ring goes amber; tiles/history are shared — expected, history is profile-agnostic).

- [ ] **Step 3: Cross-check the spec**

Re-read `docs/superpowers/specs/2026-07-15-new-tab-page-design.md` section by section and confirm each requirement is implemented. Fix any gap before proceeding.

- [ ] **Step 4: Final commit (if any fixes were made)**

```bash
git add -A && git commit -m "fix: new-tab smoke findings"
```
