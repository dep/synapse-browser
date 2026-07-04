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
