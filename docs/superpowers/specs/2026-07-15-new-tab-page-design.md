# New Tab Page — Design

Date: 2026-07-15
Status: approved

## Summary

A sleek, minimal page shown whenever the active tab is blank (fresh Cmd+T, or the
replacement tab created when the last tab closes). Top to bottom, in a centered column
(max-width ~680px): a large clock with date, a one-line weather widget, a 2×5 grid of
the 10 most-visited sites, a search field, and a searchable reverse-chronological
history list grouped by day with title-deduped rows.

## Rendering approach

The chrome UI renderer draws the page in the page cell — the same mechanism as the
settings screen. When the active tab is blank, `TabManager.syncViews()` attaches no
`WebContentsView` (extending the existing `!this.settingsOpen` condition), leaving the
window renderer fully visible there.

Rejected alternatives:

- **Bundled page in the WebContentsView** (custom `synapse://` protocol): violates the
  "page tabs get no preload and zero IPC" rule, and protocol handlers near the
  extensions session are a documented hazard.
- **Static HTML + `executeJavaScript` data injection**: stringly-typed, fragile, still
  special-cases the view.

## Trigger & lifecycle

- A tab is *blank* when its `TabInfo.url` is `''` (a view that never had `loadURL`
  called reports an empty URL). `about:blank` loaded explicitly also counts as blank.
- Main: `syncViews()` treats a blank active tab like settings — no view attached.
  The moment navigation starts, the URL becomes non-empty, `refresh()` pushes a new
  snapshot, and `syncViews()` attaches the view; the new-tab page disappears.
- Renderer: derives visibility per snapshot — `activeTab && activeTab.url === '' &&
  !settingsOpen`. No new state; it is a pure function of the snapshot plus the existing
  `onSettings` signal.
- URL bar auto-focus on new tab is unchanged. The page never steals keyboard focus on
  appearance; clicking its search field focuses it like any chrome input.

## Layout & visual design

Centered column, generous whitespace, matches existing chrome styling (fonts, muted
grays, canvas radius). All styles in `style.css` under a `.newtab-` prefix.

1. **Clock** — large thin-weight time via `Intl.DateTimeFormat` (locale decides 12/24h),
   date beneath in small muted text. A 1s interval ticks only while the page is visible
   (cleared when hidden).
2. **Weather** — one quiet line: condition glyph, rounded temperature, city
   (e.g. "☀️ 74° Los Angeles"). Absent (no reserved space) until data resolves; absent
   on failure. No error states.
3. **Top sites** — 2×5 grid of tiles: favicon + hostname label. Favicons come from the
   existing `favicons.json` host→URL store (the same join suggestions use), else a
   lettered monogram. Clicking navigates the
   current (blank) tab via `tabs.navigate`.
4. **Search field** — minimal underline input, placeholder "Search history…". Filters
   the history list live; also filters flat (no day groups) while a query is active.
5. **History list** — grouped under "Today", "Yesterday", then "July 12"-style headers.
   Row: favicon/monogram, page title (primary), hostname (muted), visit time. Clicking
   navigates the current tab. Lazy-rendered: first ~100 rows, more appended via an
   `IntersectionObserver` sentinel as the user scrolls.

Empty history → top sites and history sections hidden; the page is just clock +
weather.

## Data model & flow

### New IPC: `newtab:data`

One invoke handled in main, exposed as `synapse.newtab.data()`:

```ts
interface NewTabData {
  entries: HistoryEntry[]        // full history (≤5000), newest first
  topSites: TopSite[]            // ranked in main via shared helper
  weather: WeatherInfo | null    // null until fetched / on failure
}
interface TopSite { host: string; url: string }
// NewTabData also carries favicons: Record<string, string> (host → favicon URL,
// from FaviconStore) — the renderer joins tiles and history rows against it
interface WeatherInfo { tempC: number; code: number; city: string; useFahrenheit: boolean }
```

Two invokes so weather never blocks first paint: `newtab.data()` resolves immediately
(entries + topSites + whatever weather is already cached, else `null`), and
`newtab.weather()` resolves when the fetch completes; the renderer calls both when the
page becomes visible and fills the weather line in when the second resolves.

### Pure helpers — `src/shared/newtab.ts` (Vitest-covered)

- `topSitesFrom(entries, now): TopSite[]` — group visits by hostname, score each visit
  with the frecency bucket weights from `history-search.ts` (export/reuse
  `visitWeight`), rank hosts by total score, take 10. A host's tile URL is its
  most-visited exact URL (ties → most recent).
- `dedupeByTitle(entries): HistoryEntry[]` — newest-first scan keeps the first
  occurrence of each non-empty title; entries with empty titles dedupe by URL instead.
- `dayLabel(visitedAt, now): string` — "Today", "Yesterday", then locale month-day
  labels, using local midnight boundaries; the renderer streams rows and inserts a
  header whenever the label changes (equivalent to grouping, but lazy-render friendly).
- `filterEntries(entries, query): HistoryEntry[]` — reuses `queryTokens` +
  substring/boundary matching over title + stripped URL.

Dedupe runs before grouping and before search filtering (deduped list is the single
source the UI renders from).

### Weather fetch (main process)

- `src/main/weather.ts`: `ip-api.com/json` (lat, lon, city, countryCode) →
  Open-Meteo `current_weather` (temp °C, weathercode). Uses Electron `net`.
- Cached 30 minutes; concurrent requests share one in-flight promise.
- `useFahrenheit` = countryCode in {US, BS, BZ, KY, PW}. Renderer converts/rounds and
  maps weathercode → glyph + description (shared map in `src/shared/newtab.ts`).
- Any failure → `weather: null`, cache retried on next request after a short (5 min)
  negative-cache window.

## Error handling

- Weather failure: widget hidden, no retry UI.
- History empty or store recovering from corruption (`JsonStore` already handles the
  `.bad` rename): sections render from whatever entries exist.
- Blank-tab view detachment must not break find-in-page/zoom paths: those already
  no-op when `attached` is null (same as settings mode).
- Detach-mode checklist (learned from the final review — check these for any future
  feature that leaves the page cell view-less):
  - **Native keyboard focus**: with no view attached, focus must land on the chrome
    webContents (which carries the same Ctrl/Option+Tab cycle hooks), or chords die
    and keystrokes can leak into the invisible detached page. `syncViews()` handles
    this for blank tabs via `focusUrlBar()` on activation.
  - **Extension tab-activation**: `extensions.selectTab` normally fires on view
    attach; a resting detached state must fire `onTabActivated` explicitly or
    `chrome.tabs.query({active: true})` reports the previous tab.

## Testing

- Vitest: `topSitesFrom` (ranking, frecency weighting, tile URL choice, <10 hosts),
  `dedupeByTitle` (title dupes, empty titles, order preservation), `groupByDay`
  (today/yesterday/older, midnight boundaries), `filterEntries` (token matching),
  weathercode→glyph map completeness.
- Manual smoke via /verify harness: new tab shows clock immediately; weather appears;
  tiles ranked sensibly and clickable; search filters live; scroll loads more rows;
  navigating hides the page; settings and new-tab don't fight over the page cell;
  Ctrl+Tab cycling to/from a blank tab attaches/detaches correctly.
- `npm run typecheck` and `npm test` before completion.

## Out of scope (YAGNI)

- Settings/customization for the page (city override, tile pinning/removal).
- News feeds, wallpapers, greetings, per-profile top sites.
- Persisting weather across launches.
