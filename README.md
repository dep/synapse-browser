# Synapse Browser

A very simple Chromium browser for macOS, built on Electron.

## Features

- Vertical tabs (Arc-style sidebar)
- Pinned tabs: icon grid atop the sidebar (Cmd+P to pin/unpin, right-click for menu);
  pins persist across restarts, wake lazily, share Cmd+1–9 with tabs (pins first), and
  Ctrl+Cmd+H returns the active pin to its pinned URL
- URL bar with history suggestions (DuckDuckGo search fallback)
- MRU tab cycling: Ctrl+Tab / Ctrl+Shift+Tab (hold to walk, release to commit)
- Sidebar-order cycling: Option+Tab / Option+Shift+Tab
- Bookmarks (Cmd+D), History (Cmd+Y), Downloads to ~/Downloads
- In-app error pages, popup-to-tab handling

## Extensions

Chrome extensions are supported via `electron-chrome-extensions` +
`electron-chrome-web-store` (GPL-3.0 licensed usage).

- **Install:** visit [chromewebstore.google.com](https://chromewebstore.google.com),
  click "Add to Chrome", confirm the dialog. Extensions persist in
  `userData/Extensions` and reload on startup.
- **Dev/unpacked:** Tools → Load Unpacked Extension… (current run only, not persisted).
- **Manage:** right-click a toolbar button → remove/inspect. Toolbar buttons live right
  of the address bar; popups open anchored beneath them.
- MV2 installs are allowed (`minimumManifestVersion: 2`) so classic uBlock Origin works;
  uBlock Origin Lite (MV3) is the fallback if an MV2 API gap appears.

**Known platform gaps** (tracked in
[electron#52265](https://github.com/electron/electron/issues/52265), filed from this
repo; full analysis in
`docs/superpowers/specs/2026-07-05-mv3-webrequest-gap-scoping.md`):

1. Electron 43 ships without the extensions renderer bindings pak (Chromium 150
   packaging regression, fixed on Electron main by
   [#51804](https://github.com/electron/electron/pull/51804), backport pending), so
   `chrome.webRequest` is memberless in **all** extension contexts — MV2 and MV3. An
   MV3 worker that touches it throws and fails registration outright ("Status code:
   15") — e.g. NordPass, whose toolbar button is driven entirely by that worker.
   MV2 uBlock's network-level blocking is also affected (its ad hiding today is likely
   cosmetic content-script filtering only).
2. Even with that fixed, MV3 service workers receive no webRequest events (dispatch
   unwired upstream; MV2 background pages work). **Mitigated:** Synapse ships a
   vendored `electron-chrome-extensions` build (`vendor/*.tgz`) adding an
   observational webRequest backend — MV3 workers now receive
   `chrome.webRequest` events (verified end-to-end on Electron 43); blocking
   variants remain unsupported, matching Chrome's own MV3 rules. Upstream PR
   pending; revert to the registry pin when it ships.

`chrome.declarativeNetRequest` dynamic rules work and enforce; static `rule_resources`
never load. Never register `session.webRequest` (or `protocol.intercept*`) handlers on
the extensions session — one listener disables all extension webRequest and dNR
enforcement.

### Extension smoke checklist

1. Install Dark Reader from the web store → pages darken.
2. Install uBlock Origin → ads/trackers blocked on an ad-heavy page.
3. Install React DevTools → panel appears in DevTools on a React site.
4. A toolbar button popup opens anchored under its button, above the page.
5. Right-click a toolbar button → Remove extension → button and extension gone.
6. Restart Synapse → installed extensions reload and still work.
7. Ctrl+Tab hold-and-walk cycling still works: hold Ctrl, press Tab repeatedly to walk
   the MRU list, release to commit — the walk must not commit on each step.

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
