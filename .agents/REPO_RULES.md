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
- Never register `session.webRequest` or `protocol.intercept*` handlers on the session
  hosting extensions — a single listener silently disables all extension webRequest
  events and declarativeNetRequest enforcement for those loader factories
  (see `docs/superpowers/specs/2026-07-05-mv3-webrequest-gap-scoping.md`).

## Conventions

- TypeScript strict; no UI framework in the renderer. No runtime npm dependencies,
  with one deliberate exception: `electron-chrome-extensions` + `electron-chrome-web-store`
  (exact-pinned) — Electron ships no browser-action UI, full `chrome.tabs`, or web-store
  install flow, and reimplementing those is a multi-month project. See
  `docs/superpowers/specs/2026-07-04-extension-support-design.md`.
- Pure logic goes in Electron-free modules (`src/shared/`, `tab-model.ts`) with Vitest
  coverage; Electron-coupled code is verified by manual smoke (see README).
- Short conventional commits (`feat:`, `fix:`, `chore:`).
