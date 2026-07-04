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

### Extension smoke checklist

1. Install Dark Reader from the web store → pages darken.
2. Install uBlock Origin → ads/trackers blocked on an ad-heavy page.
3. Install React DevTools → panel appears in DevTools on a React site.
4. A toolbar button popup opens anchored under its button, above the page.
5. Right-click a toolbar button → Remove extension → button and extension gone.
6. Restart Synapse → installed extensions reload and still work.

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
