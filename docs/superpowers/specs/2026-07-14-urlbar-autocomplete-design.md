# URL Bar Autocomplete & Suggestion Ranking — Design

**Date:** 2026-07-14
**Status:** Approved

## Goal

Bring the URL bar's suggestions up to awesomebar quality (Zen/Firefox style):

- Inline autocomplete: typing `fe` fills the bar with `feedback.limitless.ai/`, the
  completed remainder selected to the end.
- Frecency ranking: frequency + recency of visits, with a bookmark bonus.
- Multi-word matching across title and URL together: "play Daily" surfaces
  "My Daily Briefing" at play.google.com.
- Dropdown rows show favicons, bold the matched text, and badge bookmarked rows
  with a star.

## Current state

- `src/shared/history-search.ts` (pure, Vitest-covered): dedupes history by URL
  (visit count = frequency signal), merges profile-filtered bookmarks, matches the
  whole query as a single substring (or char-subsequence) against
  `title + bookmarkTitle + url`, ranks match-quality → bookmarked → visit count.
  No recency signal; no multi-word matching.
- `src/renderer/topbar.ts`: input → `history:search` IPC → plain dropdown
  (title + url), arrow keys, Enter. No inline autofill, highlighting, or favicons.
- `src/main/history.ts`: one entry per visit (max 5000), so per-visit timestamps
  for frecency already exist.
- Favicons arrive as URLs via `page-favicon-updated` in `tab-manager.ts` and
  already flow to bookmarks (`onBookmarkFavicon`).

## 1. Matching & ranking (`src/shared/history-search.ts`, stays pure)

- Candidates built as today: history deduped by URL with **all visit timestamps
  collected per URL**, plus profile-filtered bookmarks merged in (profile filtering
  stays in `main/index.ts`, as today).
- Query tokenized on whitespace. **Every token must match** (case-insensitive)
  somewhere in `title + bookmarkTitle + strippedUrl` (scheme and `www.` stripped).
- Two match tiers:
  - **Tier 1:** every token matches at a word boundary (start of string or after a
    non-alphanumeric char). "play Daily" tier-1 matches `play.google.com` +
    "My **Daily** Briefing".
  - **Tier 2:** all tokens match as plain substrings.
  - The char-subsequence fallback is **dropped** (noisy, unpredictable).
- Score within a tier = **frecency + bookmark bonus**.
  - Frecency = sum over the URL's visits, weighted by age: ≤4 days → 100,
    ≤14 → 70, ≤31 → 50, ≤90 → 30, older → 10 (Firefox's buckets).
  - Bookmark bonus = 150.
  - Tiebreak: most recent visit, then stable order.
- Result limit: 6 (was 5).
- `searchSuggestions` takes `now` as a parameter (pure function, testable clocks).

## 2. Inline autofill semantics

- Only when the query has **no whitespace** (multi-word = title search).
- Candidate: highest-scored match whose stripped URL starts with the typed text
  (case-insensitive).
- Completion text: while the typed text is within the host, complete to `host/`;
  once typing extends into the path, complete to the full stripped URL.
- The autofill candidate is **promoted to dropdown rank #1** and rendered
  pre-highlighted; it carries the `autocomplete` string in the payload.
- Renderer sets bar value to `typed + remainder` and selects the remainder to the
  end. **Never autofills on deletions** (`inputType.startsWith('delete')`).
- **Enter navigates on the bar's text** via existing `classifyInput`
  (`feedback.limitless.ai/` → `https://feedback.limitless.ai/`) unless a row was
  explicitly arrow-selected or clicked — those keep exact-URL navigation.

## 3. IPC & data

- New shared type (in `src/shared/ipc.ts`), replacing `HistoryEntry` as the
  search payload:

  ```ts
  interface Suggestion {
    url: string
    title: string
    favicon: string | null
    isBookmark: boolean
    autocomplete: string | null // set only on the promoted autofill row
  }
  ```

  `history:search` keeps its channel and call signature; `SynapseApi` updated.
- **New `favicons.json` store** in main (same `JsonStore` pattern: debounced,
  `v: 1`, corrupt file → `.bad` + recreate): `host → favicon URL` map, capped at
  2000 hosts, oldest insertion dropped. Fed from tab-manager's existing
  `page-favicon-updated` handler via a new `onPageFavicon(pageUrl, favicon)`
  callback beside `onBookmarkFavicon`.
- At search time, main joins favicons by host; a bookmark's own captured favicon
  wins when present.

## 4. Renderer/UI (`src/renderer/topbar.ts` + CSS)

- Row layout: favicon `<img>` (fallback to a neutral globe glyph from `icons.ts`
  on missing/failed icon) + title + ★ badge when `isBookmark` + URL.
- **Bold matched substrings:** renderer finds each query token's first
  case-insensitive occurrence in title and URL and wraps it in a styled span.
  Built with DOM nodes only — never innerHTML containing page data.
- Overlay-height flow unchanged: `renderSuggestions` measures `offsetHeight`
  after building rows and reports it via `ui:set-overlay-height`.
- Risk to verify: the chrome UI's CSP must allow remote favicon `img-src`; if
  not, widen to `img-src https: data:` (images only, no script surface).

## 5. Testing

- Vitest for the pure scorer: token-AND matching, word-boundary tiers, frecency
  buckets, bookmark bonus, autofill candidate selection (host-prefix, `www.`
  stripping, no-spaces rule, host vs path completion), dedupe, and a named
  "play Daily → play.google.com" regression test.
- Favicon store: store-level tests (cap enforcement, corrupt file recovery).
- Renderer mechanics (autofill selection, backspace behavior, bolding) are
  Electron-coupled → manual smoke via the `verify` skill, per repo convention.

## Out of scope

- Search-engine suggestion rows ("Search for …") — declined.
- Open-tab-switch rows, provider architecture (Chrome-style omnibox) — YAGNI;
  this design doesn't preclude it later.
- SQLite/FTS indexing — unnecessary at the 5000-entry cap and would violate the
  no-runtime-deps rule.
