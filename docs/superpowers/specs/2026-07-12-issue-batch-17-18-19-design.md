# Issue Batch: #17 scrollbar theme, #18 unified traversal, #19 suggestion ranking

2026-07-12 · targets v0.5.3

## #17 — Sidebar scrollbar should match the dark theme

**Root cause.** `src/renderer/style.css` has no scrollbar styling and no
`color-scheme` declaration, so the chrome renderer's scroll containers
(`#sidebar`, `#tab-list`, `#panel`, settings, AI sidebar) get the platform
default *light* scrollbar over the hard-coded dark palette. "Intermittent"
because macOS only shows classic (opaque, tracked) scrollbars when the system
"Show scroll bars" setting resolves to Always (e.g. an external mouse is
attached); overlay mode hides the mismatch most of the time.

**Fix.** Two layers in `style.css`:

1. `color-scheme: dark` on `:root` — any native scroll UI (and future form
   controls) renders in its dark variant.
2. Explicit `::-webkit-scrollbar` rules, global to the chrome renderer:
   thin (10px) transparent track, rounded translucent-white thumb
   (`rgba(255,255,255,.14)`, hover `.28`), padded via `background-clip` so it
   reads as an 6px pill. Deterministic across macOS scrollbar settings.

Web page scrollbars belong to the sites themselves — out of scope.

**Verification.** Manual smoke (renderer CSS has no test harness): force
overflow in the sidebar, confirm dark thumb, no white track.

## #18 — Alt+Cmd+Up/Down should traverse pins + bookmarks + tabs

**Root cause.** Two traversal paths iterate different lists.
`TabModel.cycleStep('order')` (Alt+Tab) walks
`[awake pins, awake bookmark slots, ...order]`; `TabManager.activateSibling`
(Alt+Cmd+Up/Down via menu accelerators `next-tab`/`prev-tab`) walks only
`model.order`, so slots are unreachable.

**Fix.** Single source of truth in the model:

- Extract the composite list into a private `TabModel.orderCycleIds()`;
  `cycleStep('order')` uses it.
- Add pure `TabModel.sibling(dir: 1 | -1): string | null` — immediate
  wraparound walk over `orderCycleIds()`; when `activeId` is absent from the
  list (or null), dir 1 lands on the first id, dir −1 on the last.
- `TabManager.activateSibling` becomes `sibling()` + `activateTab()`.

Parity decision: like Alt+Tab, only *awake* slots participate (asleep slots
wake via click/Cmd+1..9, not passing traversal). `activateTab` already handles
awake slot ids (sidebar clicks use the same path).

**Verification.** Unit tests on `TabModel.sibling` in `tests/tab-model.test.ts`
(slots included, wraparound both directions, asleep slots skipped, active-not-
in-list fallback, no-op cases). Order-cycle regression tests already cover
`orderCycleIds` via `cycleStep`.

## #19 — Autocomplete favors bookmarks and visit frequency

**Root cause.** `searchHistory` (src/shared/history-search.ts) sources history
only and scores just match quality (substring=2 / subsequence=1), tie-broken by
recency. Bookmarks are invisible to the omnibox; frequency is ignored.

**Key insight — no schema change needed.** `HistoryStore.add` prepends one
entry *per visit* (deduping only consecutive repeats), so visit frequency per
URL is countable at search time from the retained window (5000 entries).

**Fix.** New pure `searchSuggestions(entries, bookmarks, query, limit)`
replaces `searchHistory` outright (its callers were the store and tests).

Candidates, built in one pass into a `Map<url, candidate>`:
- one per unique history URL — title/visitedAt from the newest entry, `visits`
  = occurrence count, plus the bookmark title when the URL is bookmarked (the
  match haystack includes both titles, so a renamed bookmark stays findable
  after visits; the suggestion still shows the fresher history title);
- plus each bookmark whose URL never appears in history — bookmark title,
  `visitedAt` = createdAt, `visits` = 0.

Ranking is lexicographic, stable within ties (candidates are built
newest-first, bookmark-only last):
1. match tier (substring 2 > subsequence 1; 0 drops) — relevance still wins;
2. bookmarked over not — an explicit keep beats raw traffic;
3. visit count, descending;
4. recency (stable-sort order).

Wiring: composition lives in the `history:search` IPC handler (the one place
both stores are in scope) — `searchSuggestions(history.entries(),
profileBookmarks, q)`. `HistoryStore` stays purely history. Bookmarks are
filtered to the active tab's profile: a Work bookmark suggested to a default
tab would load the Work URL in the default session, the exact exposure the
Work container exists to prevent (shared history is unchanged and was already
cross-profile). Return type stays `HistoryEntry[]` — renderer untouched.

**Verification.** Unit tests: bookmark beats non-bookmark at equal tier,
frequency orders within a tier, match tier still dominates both, bookmark-only
URLs surface, history+bookmark URLs dedupe to one boosted row that still
matches the bookmark's own title, store keeps one entry per non-consecutive
revisit (pins the frequency signal). Runtime smoke over CDP for the composed
IPC path.
