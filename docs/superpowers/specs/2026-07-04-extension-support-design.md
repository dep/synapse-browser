# Chrome Extension Support — Design

**Date:** 2026-07-04
**Status:** Approved

## Goal

Synapse can install, run, persist, and remove Chrome extensions across all four major
categories: content-tweaking (Dark Reader, Vimium), ad blocking (uBlock Origin),
DevTools extensions (React DevTools), and toolbar-button extensions with popups
(password managers).

## Decisions made

- **Adopt runtime dependencies** `electron-chrome-extensions` and
  `electron-chrome-web-store` (samuelmaddock). This is a deliberate carve-out from the
  "no runtime npm dependencies" rule in `.agents/REPO_RULES.md`; the rule file gets an
  explicit exception noting why (Electron provides no browser-action UI, no full
  `chrome.tabs`, and no web-store install flow — reimplementing these is a
  multi-month project).
- **Install UX:** Chrome Web Store ("Add to Chrome" on chromewebstore.google.com works
  natively) plus a "load unpacked folder" escape hatch for development.
- **Management UI:** context menus only. Right-click a toolbar button → remove/inspect.
  No dedicated extensions page.
- **License:** `ElectronChromeExtensions` is instantiated with `license: 'GPL-3.0'`.
  Implication: if Synapse is ever distributed, it must be GPL-3.0 licensed (the
  alternative is the paid Patron license). Acceptable for a personal project.

## Architecture

New module `src/main/extensions.ts` exports an `ExtensionManager` owning both
libraries. All extension state lives in the main process, consistent with the existing
"all tab state lives in main" architecture.

- Binds `ElectronChromeExtensions` to `session.defaultSession` — the session tabs
  already use, so extensions observe all page traffic.
- Startup: `installChromeWebStore({ session })` hooks the web-store install flow;
  `loadAllExtensions(session, <userData>/Extensions)` reloads installed extensions from
  disk. Persistence is the library's on-disk layout — no new store file, no schema.
- "Load unpacked": a menu item (Develop-style) opens a directory picker and calls
  `session.extensions.loadExtension(path)`.

## TabManager integration

The library speaks `WebContents`; `TabManager` speaks tab ids. Three small additions to
`src/main/tab-manager.ts`:

1. `webContentsFor(id): WebContents | null` — forward lookup.
2. `idFor(wc: WebContents): string | null` — reverse lookup (scan `views`).
3. `onTabActivated?(wc: WebContents)` in `TabManagerOptions`, fired from `syncViews`
   when the attached view changes.

Wiring in `src/main/index.ts`:

- Existing `onTabCreated` hook additionally calls `extensions.addTab(wc, win)`.
- New `onTabActivated` calls `extensions.selectTab(wc)`.
- The library's browser-actions callbacks delegate to TabManager:
  `createTab(details)` → `tabs.createTab(details.url)` (returns `[wc, win]`),
  `selectTab(wc)` → `tabs.activateTab(idFor(wc))`,
  `removeTab(wc)` → `tabs.closeTab(idFor(wc))`.

`src/main/tab-model.ts` stays untouched and Electron-free.

## Chrome UI

- `src/preload/index.ts` imports the library's browser-action module, registering the
  `<browser-action-list>` custom element in the chrome renderer.
- `src/renderer/topbar.ts` places `<browser-action-list>` on the right side of the
  topbar. The element renders extension buttons and badges and handles clicks.
- Popups render as small child `BrowserWindow`s anchored under the button (library
  behavior), so they float above the page `WebContentsView`. No interaction with the
  `ui:set-overlay-height` mechanism.
- Right-clicking a button shows the extension context menu (remove, inspect popup) —
  this is the entire management surface.

## Security

Web page tabs keep `sandbox: true`, `contextIsolation: true`, and **no app preload**.
electron-chrome-extensions registers its own session-level preload (extension API
plumbing for content scripts and MV3 service workers) — that preload is
library-managed, sandbox-compatible, and exposes no app IPC; `window.synapse` never
reaches web pages. Content scripts themselves are injected by Chromium. The chrome UI
preload gains only the browser-action element registration; `SynapseApi` is unchanged.

## Error handling

- A broken/corrupt extension directory at startup logs a warning and is skipped; boot
  never blocks (mirrors the corrupt-store `.bad` philosophy).
- Failed web-store installs surface the library's own error UI.
- Extension-initiated `chrome.tabs` calls referencing unknown tabs are no-ops.

## Known risks

- **uBlock Origin (MV2, blocking webRequest)** is the demanding acceptance test. It
  works in the library's reference browser; if Electron 43 leaves an API gap, the
  documented fallback is uBlock Origin Lite (MV3). Pixel-perfect Chrome adblock parity
  is out of scope; the install-and-block happy path is in scope.
- Library version drift: pin exact versions of both deps.

## Testing

No new Electron-free pure logic, so no new unit tests. Verification is a manual smoke
checklist added to the README:

1. Visit chromewebstore.google.com, install Dark Reader → pages darken.
2. Install uBlock Origin → ads/trackers blocked on a known ad-heavy page.
3. Install React DevTools → panel appears in DevTools on a React site.
4. Toolbar button popup opens anchored under its button, above the page.
5. Right-click a button → Remove extension → button disappears, extension gone.
6. Restart Synapse → installed extensions reload and still work.

`npm run typecheck` and `npm test` must stay green.

## Touched files

| File | Change |
|---|---|
| `src/main/extensions.ts` | new — `ExtensionManager` |
| `src/main/tab-manager.ts` | `webContentsFor`, `idFor`, `onTabActivated` |
| `src/main/index.ts` | instantiate + wire ExtensionManager; unpacked-load menu hook |
| `src/main/menu.ts` | "Load Unpacked Extension…" item |
| `src/preload/index.ts` | import browser-action element |
| `src/renderer/index.html` | `<browser-action-list>` in topbar markup + `crx:` in CSP |
| `package.json` | add pinned `electron-chrome-extensions`, `electron-chrome-web-store` |
| `.agents/REPO_RULES.md` | dependency carve-out note |
| `README.md` | extensions section + smoke checklist |
