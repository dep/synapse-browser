# Chrome Extension Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synapse installs, runs, persists, and removes Chrome extensions (content scripts, ad blockers, DevTools panels, toolbar-button popups) via the Chrome Web Store and unpacked folders.

**Architecture:** A new main-process `ExtensionManager` (`src/main/extensions.ts`) wraps `electron-chrome-extensions` (browser-action UI + chrome.* plumbing) and `electron-chrome-web-store` (install flow + disk persistence), bound to `session.defaultSession` — the session tabs already use. `TabManager` gains two lookups and one callback so the library's WebContents-based world maps onto Synapse tab ids. The chrome UI renders a `<browser-action-list>` custom element registered by the chrome preload.

**Tech Stack:** Electron 43, electron-vite 5, TypeScript strict, `electron-chrome-extensions@4.9.0`, `electron-chrome-web-store@0.13.0` (exact-pinned).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-04-extension-support-design.md`.
- Dependencies are pinned exact: `electron-chrome-extensions@4.9.0`, `electron-chrome-web-store@0.13.0`. No other runtime deps.
- License param is exactly `'GPL-3.0'`.
- Web page tabs keep `sandbox: true, contextIsolation: true` and get **no app preload** (the library auto-registers its own session-level extension-plumbing preload; that is expected and exposes no app IPC).
- `src/main/tab-model.ts` must not change.
- `window.synapse` / `SynapseApi` in `src/shared/ipc.ts` must not change.
- Extension boot failures must never block app startup (log and continue).
- After every task: `npm run typecheck` and `npm test` pass.
- Commits are short conventional style (`feat:`, `fix:`, `docs:`, `chore:`).

## Verification model (read once)

Per `.agents/REPO_RULES.md`, pure logic gets Vitest coverage; Electron-coupled code is verified by manual smoke. Every change in this plan is Electron-coupled (session wiring, WebContentsView lookups, custom elements), so tasks verify via `npm run typecheck`, the existing `npm test` suite staying green, and dev-run smoke checks. No new unit tests are added; `tab-model.ts` and its tests are untouched.

---

### Task 1: Dependencies + build config

**Files:**
- Modify: `package.json` (via npm CLI)
- Modify: `electron.vite.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `electron-chrome-extensions` and `electron-chrome-web-store` importable from main-process and preload code; main bundle externalizes runtime deps so the libraries' internal `require.resolve(...'/preload')` calls work at runtime.

- [ ] **Step 1: Install both packages as exact-pinned runtime dependencies**

```bash
cd /Users/dep/Sites/synapse-browser
npm install --save --save-exact electron-chrome-extensions@4.9.0 electron-chrome-web-store@0.13.0
```

Expected: package.json gains a `dependencies` block with both packages at exact versions; install completes without errors. (Neither package has install scripts, so `allowScripts` needs no new entries.)

- [ ] **Step 2: Externalize runtime deps in the main-process bundle**

The libraries resolve their own preload files at runtime via `require.resolve('electron-chrome-extensions/preload')` — bundling them into `out/main/index.js` would break that. Externalize deps for **main only**. The chrome preload must keep bundling its imports (sandboxed preloads cannot `require` from node_modules), so `preload` stays as-is.

Replace the entire content of `electron.vite.config.ts` with:

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  // main runs from node_modules so the extension libs can resolve their own
  // preload files at runtime; the chrome preload bundles its imports because
  // sandboxed preloads can't require() external modules
  main: { plugins: [externalizeDepsPlugin()] },
  preload: {},
  renderer: {},
})
```

- [ ] **Step 3: Verify build health**

```bash
npm run typecheck && npm test && npm run build
```

Expected: typecheck clean, all existing Vitest tests pass, build produces `out/` without errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json electron.vite.config.ts
git commit -m "chore: add pinned extension deps, externalize main bundle deps"
```

---

### Task 2: TabManager lookups + activation callback

**Files:**
- Modify: `src/main/tab-manager.ts`

**Interfaces:**
- Consumes: existing `TabManager` internals (`views` map, `syncViews`, `TabManagerOptions`).
- Produces (used by Task 3):
  - `webContentsFor(id: string): WebContents | null`
  - `idFor(wc: WebContents): string | null`
  - `TabManagerOptions.onTabActivated?(wc: WebContents): void` — fired whenever the attached (visible) view changes to a new view.

- [ ] **Step 1: Add `onTabActivated` to `TabManagerOptions`**

In `src/main/tab-manager.ts`, the options interface currently reads:

```ts
export interface TabManagerOptions {
  isBookmarked(url: string): boolean
  onNavigated(url: string, title: string): void
  onSnapshot(snap: TabsSnapshot): void
  onTabCreated?(wc: WebContents): void
}
```

Add one member:

```ts
export interface TabManagerOptions {
  isBookmarked(url: string): boolean
  onNavigated(url: string, title: string): void
  onSnapshot(snap: TabsSnapshot): void
  onTabCreated?(wc: WebContents): void
  onTabActivated?(wc: WebContents): void
}
```

- [ ] **Step 2: Fire it from `syncViews` and add the two lookups**

`syncViews` currently reads:

```ts
  private syncViews(): void {
    const active = this.model.activeId ? (this.views.get(this.model.activeId) ?? null) : null
    if (this.attached !== active) {
      if (this.attached) this.win.contentView.removeChildView(this.attached)
      if (active) this.win.contentView.addChildView(active)
      this.attached = active
    }
    this.layout()
    this.refresh()
  }
```

Change it to fire the callback when a new view becomes attached:

```ts
  private syncViews(): void {
    const active = this.model.activeId ? (this.views.get(this.model.activeId) ?? null) : null
    if (this.attached !== active) {
      if (this.attached) this.win.contentView.removeChildView(this.attached)
      if (active) this.win.contentView.addChildView(active)
      this.attached = active
      if (active) this.opts.onTabActivated?.(active.webContents)
    }
    this.layout()
    this.refresh()
  }
```

Then add the two public lookups directly after the existing `isAwake(id)` method:

```ts
  webContentsFor(id: string): WebContents | null {
    return this.views.get(id)?.webContents ?? null
  }

  idFor(wc: WebContents): string | null {
    for (const [id, view] of this.views) if (view.webContents === wc) return id
    return null
  }
```

- [ ] **Step 3: Verify**

```bash
npm run typecheck && npm test
```

Expected: both clean. (`tab-model.ts` untouched; existing tests unaffected.)

- [ ] **Step 4: Commit**

```bash
git add src/main/tab-manager.ts
git commit -m "feat: tab lookups and activation callback for extension wiring"
```

---

### Task 3: ExtensionManager + main-process wiring

**Files:**
- Create: `src/main/extensions.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes (from Task 2): `tabs.webContentsFor(id)`, `tabs.idFor(wc)`, `TabManagerOptions.onTabActivated`.
- Produces (used by Tasks 4–5):
  - `class ExtensionManager` with constructor `(win: BrowserWindow, tabs: TabManager)`, and methods `addTab(wc: WebContents): void`, `selectTab(wc: WebContents): void`, `init(): Promise<void>`, `loadUnpacked(): Promise<void>`.
  - `crx://` protocol registered on the default session (topbar icons in Task 4 depend on it).

- [ ] **Step 1: Create `src/main/extensions.ts`**

```ts
import { app, dialog, session } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { join } from 'node:path'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore } from 'electron-chrome-web-store'
import type { TabManager } from './tab-manager'

// Binds electron-chrome-extensions + the web-store install flow to the default
// session (the one all tabs use). Extension files persist under
// <userData>/Extensions, managed entirely by electron-chrome-web-store.
export class ExtensionManager {
  private extensions: ElectronChromeExtensions

  constructor(
    private win: BrowserWindow,
    tabs: TabManager,
  ) {
    this.extensions = new ElectronChromeExtensions({
      license: 'GPL-3.0',
      session: session.defaultSession,
      createTab: async (details) => {
        const id = tabs.createTab(details.url, details.active ?? true)
        return [tabs.webContentsFor(id)!, this.win]
      },
      selectTab: (wc) => {
        const id = tabs.idFor(wc)
        if (id) tabs.activateTab(id)
      },
      removeTab: (wc) => {
        const id = tabs.idFor(wc)
        if (id) tabs.closeTab(id)
      },
    })
    // serves crx://extension-icon/... — without this the <browser-action-list>
    // element renders empty buttons
    ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
  }

  addTab(wc: WebContents): void {
    this.extensions.addTab(wc, this.win)
  }

  selectTab(wc: WebContents): void {
    this.extensions.selectTab(wc)
  }

  // installs the chromewebstore.google.com "Add to Chrome" hook and loads
  // previously installed extensions from disk
  async init(): Promise<void> {
    await installChromeWebStore({
      session: session.defaultSession,
      extensionsPath: join(app.getPath('userData'), 'Extensions'),
      minimumManifestVersion: 2, // default 3 would block MV2 installs like uBlock Origin classic
      beforeInstall: async (details) => {
        const { response } = await dialog.showMessageBox(this.win, {
          type: 'question',
          buttons: ['Cancel', 'Install'],
          defaultId: 1,
          cancelId: 0,
          message: `Add "${details.localizedName}" to Synapse?`,
        })
        return { action: response === 1 ? 'allow' : 'deny' }
      },
    })
    await this.startMV3ServiceWorkers()
  }

  // Electron loads MV3 extensions but does not spin up their background
  // service workers on its own (mirrors the reference shell browser)
  private async startMV3ServiceWorkers(): Promise<void> {
    const ses = session.defaultSession
    for (const ext of ses.extensions.getAllExtensions()) {
      const manifest = ext.manifest as {
        manifest_version?: number
        background?: { service_worker?: string }
      }
      if (manifest.manifest_version !== 3 || !manifest.background?.service_worker) continue
      try {
        await ses.serviceWorkers.startWorkerForScope(ext.url)
      } catch (err) {
        console.warn(`extensions: failed to start worker for ${ext.name}:`, err)
      }
    }
  }

  // dev escape hatch; loaded for this run only, not persisted
  async loadUnpacked(): Promise<void> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.win, {
      title: 'Load Unpacked Extension',
      properties: ['openDirectory'],
    })
    if (canceled || !filePaths[0]) return
    try {
      await session.defaultSession.extensions.loadExtension(filePaths[0])
    } catch (err) {
      dialog.showErrorBox('Failed to load extension', err instanceof Error ? err.message : String(err))
    }
  }
}
```

- [ ] **Step 2: Wire it in `src/main/index.ts`**

2a. Add the import after the existing `DownloadManager` import:

```ts
import { ExtensionManager } from './extensions'
```

2b. Make the ready callback async. Change:

```ts
app.whenReady().then(() => {
```

to:

```ts
app.whenReady().then(async () => {
```

2c. Extend the `TabManager` options. The current construction ends with:

```ts
    onTabCreated: (wc) => attachCycleHooks(wc),
  })
```

Replace those two lines with:

```ts
    // `extensions` is declared below; safe because tabs are only created
    // after it exists (restoreTabs runs at the end of startup)
    onTabCreated: (wc) => {
      attachCycleHooks(wc)
      extensions.addTab(wc)
    },
    onTabActivated: (wc) => extensions.selectTab(wc),
  })
  const extensions = new ExtensionManager(win, tabs)
```

2d. Initialize the web store before tabs are restored (so restored pages get content scripts). The startup sequence currently ends with:

```ts
  tabs.restorePins(pinsStore.load())
  const saved = tabsStore.load()
  tabs.restoreTabs(saved.urls, saved.active)
```

Insert the init immediately before `tabs.restorePins(...)`:

```ts
  try {
    await extensions.init()
  } catch (err) {
    console.error('extensions: startup failed, continuing without extensions', err)
  }
```

- [ ] **Step 3: Verify boot**

```bash
npm run typecheck && npm test
```

Expected: clean. Then:

```bash
npm run dev
```

Expected: app boots, tabs restore, no extension-related errors in the terminal. Quit the app after checking.

- [ ] **Step 4: Commit**

```bash
git add src/main/extensions.ts src/main/index.ts
git commit -m "feat: ExtensionManager with web-store installs and tab wiring"
```

---

### Task 4: Chrome UI — toolbar buttons

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/style.css`

**Interfaces:**
- Consumes: `crx://` protocol + extension state from Task 3 (over the library's own IPC — no `SynapseApi` change).
- Produces: `<browser-action-list>` rendering extension buttons in the topbar; popups open as child windows above the page view.

- [ ] **Step 1: Register the custom element from the chrome preload**

In `src/preload/index.ts`, add at the top, after the existing imports:

```ts
import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'
```

and at the bottom of the file, after `contextBridge.exposeInMainWorld('synapse', api)`:

```ts
// registers <browser-action-list>; this preload only ever runs in the chrome
// UI window, never in web page tabs
injectBrowserAction()
```

- [ ] **Step 2: Add the element and allow crx: icons**

In `src/renderer/index.html`:

2a. Extension icons are served over the `crx:` protocol; the current CSP blocks them. Change the CSP meta content from:

```
default-src 'self'; style-src 'self' 'unsafe-inline'; img-src https: http: data:
```

to:

```
default-src 'self'; style-src 'self' 'unsafe-inline'; img-src https: http: data: crx:
```

2b. Add the element between the star button and the download pill:

```html
        <button id="star" title="Bookmark this page">☆</button>
        <browser-action-list id="actions"></browser-action-list>
        <button id="download-pill" hidden></button>
```

(Default alignment `bottom left` matches the reference shell's topbar-right placement; `partition`/`tab` attributes are omitted so the element follows the default session's active tab.)

- [ ] **Step 3: Style it into the topbar row**

In `src/renderer/style.css`, add at the end:

```css
/* extension toolbar buttons (electron-chrome-extensions custom element) */
browser-action-list {
  flex: none;
  display: flex;
  align-items: center;
}
```

- [ ] **Step 4: Verify visually**

```bash
npm run typecheck && npm test && npm run dev
```

Expected: typecheck/test clean; app boots with an (empty, invisible) action list and no console/CSP errors in the chrome UI devtools. Quit after checking.

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/renderer/index.html src/renderer/style.css
git commit -m "feat: browser-action toolbar in topbar"
```

---

### Task 5: "Load Unpacked Extension…" menu item

**Files:**
- Modify: `src/main/menu.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes (from Task 3): `ExtensionManager.loadUnpacked(): Promise<void>`.
- Produces: Tools menu item invoking the directory picker.

- [ ] **Step 1: Extend `buildMenu`**

In `src/main/menu.ts`, change the signature:

```ts
export function buildMenu(win: BrowserWindow, tabs: TabManager, toggleBookmark: () => void): void {
```

to:

```ts
import type { ExtensionManager } from './extensions'

export function buildMenu(
  win: BrowserWindow,
  tabs: TabManager,
  toggleBookmark: () => void,
  extensions: ExtensionManager,
): void {
```

(the `import type` line goes with the other imports at the top of the file). Then in the `Tools` submenu, after the `Bookmarks` item, add:

```ts
        { type: 'separator' },
        {
          label: 'Load Unpacked Extension…',
          click: () => void extensions.loadUnpacked(),
        },
```

- [ ] **Step 2: Pass it at the call site**

In `src/main/index.ts`, change:

```ts
  buildMenu(win, tabs, toggleBookmark)
```

to:

```ts
  buildMenu(win, tabs, toggleBookmark, extensions)
```

- [ ] **Step 3: Verify**

```bash
npm run typecheck && npm test
```

Expected: clean. Then `npm run dev`: Tools menu shows "Load Unpacked Extension…", clicking opens a directory picker, cancel is harmless. Quit after checking.

- [ ] **Step 4: Commit**

```bash
git add src/main/menu.ts src/main/index.ts
git commit -m "feat: load unpacked extension menu item"
```

---

### Task 6: Documentation + rule carve-out + spec correction

**Files:**
- Modify: `.agents/REPO_RULES.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-04-extension-support-design.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: REPO_RULES dependency carve-out**

In `.agents/REPO_RULES.md`, under `## Conventions`, change the line:

```
- TypeScript strict; no runtime npm dependencies; no UI framework in the renderer.
```

to:

```
- TypeScript strict; no UI framework in the renderer. No runtime npm dependencies,
  with one deliberate exception: `electron-chrome-extensions` + `electron-chrome-web-store`
  (exact-pinned) — Electron ships no browser-action UI, full `chrome.tabs`, or web-store
  install flow, and reimplementing those is a multi-month project. See
  `docs/superpowers/specs/2026-07-04-extension-support-design.md`.
```

- [ ] **Step 2: Correct the spec's Security section**

Implementation research showed v4 of the library **auto-registers its own preload on the session** (frame + service-worker types) rather than injecting "natively". In `docs/superpowers/specs/2026-07-04-extension-support-design.md`, replace the Security section's first paragraph:

```
Web page tabs keep `sandbox: true`, `contextIsolation: true`, and **no preload**.
electron-chrome-extensions v4 injects extension plumbing natively (no tab preload
required), and content scripts are injected by Chromium itself. If implementation
discovers a tab preload is unavoidable, that is a stop-and-re-plan checkpoint — not a
silent rule change. The chrome UI preload gains only the browser-action element
registration; `window.synapse` (`SynapseApi`) is unchanged.
```

with:

```
Web page tabs keep `sandbox: true`, `contextIsolation: true`, and **no app preload**.
electron-chrome-extensions registers its own session-level preload (extension API
plumbing for content scripts and MV3 service workers) — that preload is
library-managed, sandbox-compatible, and exposes no app IPC; `window.synapse` never
reaches web pages. Content scripts themselves are injected by Chromium. The chrome UI
preload gains only the browser-action element registration; `SynapseApi` is unchanged.
```

- [ ] **Step 3: README extensions section**

In `README.md`, add a section (after whatever feature section currently ends the feature list):

```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add .agents/REPO_RULES.md README.md docs/superpowers/specs/2026-07-04-extension-support-design.md
git commit -m "docs: extension support docs, dependency carve-out, spec correction"
```

---

### Task 7: Manual smoke test (with the user)

**Files:** none.

**Interfaces:** consumes everything above.

- [ ] **Step 1: Launch**

```bash
npm run dev
```

- [ ] **Step 2: Walk the README smoke checklist with the user**

Run all six checklist items from Task 6 Step 3. The demanding ones:

- uBlock Origin (MV2) is the acceptance test; if its install or blocking fails,
  install uBlock Origin Lite instead and record the gap in the README.
- Toolbar popup anchoring: popup must render **above** the page view (it is a child
  BrowserWindow — if it appears behind the page, that is a bug to fix, not accept).
- Right-click remove: if the element's built-in context menu lacks "Remove extension",
  stop and re-plan the management surface (spec decision was context-menus-only).

- [ ] **Step 3: Confirm exit criteria**

```bash
npm run typecheck && npm test
```

Expected: clean. All six smoke items pass (or documented fallback recorded). Working tree clean, all tasks committed.
