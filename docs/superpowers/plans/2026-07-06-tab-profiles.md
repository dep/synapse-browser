# Tab Profiles (Default + Work) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tab be assigned to an isolated "Work" session container via the tab context menu, so two Gmail accounts can run side by side in one window.

**Architecture:** Work tabs get `webPreferences.partition: 'persist:profile-work'` (isolated cookies/storage/cache). Switching a tab's profile destroys and recreates its `WebContentsView` in the new partition (same lifecycle as pin sleep/wake); the tab keeps its id and sidebar/MRU position. Extensions stay bound to the default session only; Work tabs are never registered with `ElectronChromeExtensions`.

**Tech Stack:** Electron (main-process `WebContentsView` + `session.fromPartition`), TypeScript strict, Vitest for pure modules.

Spec: `docs/superpowers/specs/2026-07-06-tab-profiles-design.md`

## Global Constraints

- TypeScript strict. Tasks 1 and 3 leave known, explicitly-listed type errors in `src/main/index.ts` (old call-site shapes); Task 4 closes them. From Task 4 on, `npm run typecheck` must be clean at every commit. `npm test` must pass at every commit throughout.
- No new runtime npm dependencies.
- Never register `session.webRequest` or `protocol.intercept*` handlers on ANY session (repo rule — kills extension webRequest).
- No UI framework in the renderer; DOM APIs only.
- Pure logic gets Vitest coverage; Electron-coupled code is verified by typecheck + manual smoke.
- Commits: short conventional (`feat:`, `fix:`, `test:`); no backticks in commit messages.
- `src/main/tab-model.ts` must NOT be modified (profiles don't affect ordering/MRU).

---

### Task 1: ProfileId type + TabsStore v2 schema

**Files:**
- Modify: `src/shared/ipc.ts:1` (add `ProfileId` above `PinSlot`)
- Modify: `src/main/tabs-store.ts` (full rewrite shown below)
- Test: `tests/tabs-store.test.ts` (full rewrite shown below)

**Interfaces:**
- Consumes: existing `JsonStore<T>` from `src/main/store.ts`.
- Produces: `type ProfileId = 'default' | 'work'` and `interface TabEntry { url: string; profile: ProfileId }` exported from `src/shared/ipc.ts` / `src/main/tabs-store.ts` respectively; `TabsStore.save(tabs: TabEntry[], active: number)` and `TabsStore.load(): { tabs: TabEntry[]; active: number }`. Task 4 calls both.

- [ ] **Step 1: Add ProfileId to shared types**

At the top of `src/shared/ipc.ts` (above `PinSlot`):

```ts
export type ProfileId = 'default' | 'work'
```

- [ ] **Step 2: Rewrite the test file (failing)**

Replace the whole body of `tests/tabs-store.test.ts` with:

```ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TabsStore } from '../src/main/tabs-store'

describe('TabsStore', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabsstore-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('starts empty with no saved file', () => {
    expect(new TabsStore(dir).load()).toEqual({ tabs: [], active: -1 })
  })

  it('round-trips urls, profiles, and active index across instances', () => {
    const store = new TabsStore(dir)
    const tabs = [
      { url: 'https://a.test/', profile: 'default' as const },
      { url: 'https://b.test/', profile: 'work' as const },
    ]
    store.save(tabs, 1)
    store.flush()
    expect(new TabsStore(dir).load()).toEqual({ tabs, active: 1 })
  })

  it('keeps non-web urls as blank-tab placeholders', () => {
    const store = new TabsStore(dir)
    store.save(
      [
        { url: '', profile: 'default' },
        { url: 'data:text/html,error', profile: 'work' },
        { url: 'https://ok.test/', profile: 'default' },
        { url: 'about:blank', profile: 'default' },
      ],
      2,
    )
    expect(store.load().tabs.map((t) => t.url)).toEqual(['', '', 'https://ok.test/', ''])
  })

  it('clamps a stale active index into range', () => {
    const store = new TabsStore(dir)
    store.save([{ url: 'https://a.test/', profile: 'default' }], 5)
    expect(store.load().active).toBe(0)
    store.save([{ url: 'https://a.test/', profile: 'default' }], -1)
    expect(store.load().active).toBe(0)
  })

  it('loads a v1 file (urls array) as default-profile tabs', () => {
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({ v: 1, urls: ['https://a.test/', 'https://b.test/'], active: 1 }),
    )
    expect(new TabsStore(dir).load()).toEqual({
      tabs: [
        { url: 'https://a.test/', profile: 'default' },
        { url: 'https://b.test/', profile: 'default' },
      ],
      active: 1,
    })
  })

  it('ignores malformed contents from a hand-edited file', () => {
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({
        v: 2,
        tabs: [{ url: 'https://a.test/', profile: 'nonsense' }, { url: 42 }, 'junk', null],
        active: 'x',
      }),
    )
    expect(new TabsStore(dir).load()).toEqual({
      tabs: [{ url: 'https://a.test/', profile: 'default' }],
      active: 0,
    })
  })

  it('recovers from a corrupt file', () => {
    fs.writeFileSync(path.join(dir, 'tabs.json'), '{nope')
    expect(new TabsStore(dir).load()).toEqual({ tabs: [], active: -1 })
    expect(fs.existsSync(path.join(dir, 'tabs.json.bad'))).toBe(true)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/tabs-store.test.ts`
Expected: FAIL — compile/type errors (`save` doesn't accept objects) and assertion failures.

- [ ] **Step 4: Rewrite TabsStore**

Replace the whole body of `src/main/tabs-store.ts` with:

```ts
import * as path from 'node:path'
import type { ProfileId } from '../shared/ipc'
import { JsonStore } from './store'

export interface TabEntry {
  url: string
  profile: ProfileId
}

interface TabsFileV1 {
  v: 1
  urls: string[]
  active: number
}

interface TabsFileV2 {
  v: 2
  tabs: TabEntry[]
  active: number
}

type TabsFile = TabsFileV1 | TabsFileV2

// only real web pages restore to their url; blank tabs and transient pages
// (error data: urls, about:) come back as empty new tabs
const PERSISTABLE = /^https?:\/\//

export class TabsStore {
  private store: JsonStore<TabsFile>

  constructor(dir: string) {
    this.store = new JsonStore<TabsFile>(path.join(dir, 'tabs.json'), { v: 2, tabs: [], active: -1 })
  }

  save(tabs: TabEntry[], active: number): void {
    this.store.set({
      v: 2,
      tabs: tabs.map((t) => ({ url: PERSISTABLE.test(t.url) ? t.url : '', profile: t.profile })),
      active,
    })
  }

  load(): { tabs: TabEntry[]; active: number } {
    const data = this.store.get()
    // v1 files carried a plain urls array; they load as default-profile tabs
    const raw: unknown[] =
      'tabs' in data && Array.isArray(data.tabs)
        ? data.tabs
        : 'urls' in data && Array.isArray(data.urls)
          ? data.urls.map((url) => ({ url, profile: 'default' }))
          : []
    const clean = raw.flatMap((t): TabEntry[] => {
      if (typeof t !== 'object' || t === null) return []
      const { url, profile } = t as { url?: unknown; profile?: unknown }
      if (typeof url !== 'string') return []
      return [{ url, profile: profile === 'work' ? 'work' : 'default' }]
    })
    const idx = Number.isInteger(data.active) ? data.active : 0
    return { tabs: clean, active: Math.min(Math.max(idx, 0), clean.length - 1) }
  }

  flush(): void {
    this.store.flush()
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/tabs-store.test.ts`
Expected: PASS (7 tests).

Note: `npm run typecheck` will fail here — `src/main/index.ts` still calls the old `save(urls, active)` signature. That call site is fixed in Task 4; do NOT run typecheck as a gate for this commit (the repo has no CI; Task 6 gates the branch).

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/main/tabs-store.ts tests/tabs-store.test.ts
git commit -m "feat: tabs-store v2 schema with per-tab profile"
```

---

### Task 2: PinsStore carries profile

**Files:**
- Modify: `src/shared/ipc.ts:1-5` (`PinSlot` gains optional `profile`)
- Modify: `src/main/pins-store.ts:29-33` (normalize profile on load)
- Test: `tests/pins-store.test.ts`

**Interfaces:**
- Consumes: `ProfileId` from Task 1.
- Produces: `PinSlot.profile?: ProfileId` (optional so existing constructors stay valid; `PinsStore.load()` always returns it set). Task 3 writes it when pinning; Task 4 persists it.

- [ ] **Step 1: Update PinSlot in src/shared/ipc.ts**

```ts
export interface PinSlot {
  url: string
  title: string
  favicon: string | null
  profile?: ProfileId
}
```

- [ ] **Step 2: Add failing tests**

In `tests/pins-store.test.ts`, replace the `round-trips pin slots across instances` test and add a migration test:

```ts
  it('round-trips pin slots across instances', () => {
    const store = new PinsStore(dir)
    const pins = [
      { url: 'https://a.test/', title: 'A', favicon: 'https://a.test/icon.png', profile: 'default' as const },
      { url: 'https://b.test/', title: 'B', favicon: null, profile: 'work' as const },
    ]
    store.save(pins)
    store.flush()
    expect(new PinsStore(dir).load()).toEqual(pins)
  })

  it('loads pins missing a profile as default', () => {
    fs.writeFileSync(
      path.join(dir, 'pins.json'),
      JSON.stringify({ v: 1, pins: [{ url: 'https://a.test/', title: 'A', favicon: null }] }),
    )
    expect(new PinsStore(dir).load()).toEqual([
      { url: 'https://a.test/', title: 'A', favicon: null, profile: 'default' },
    ])
  })
```

Also update the expectation in `ignores malformed entries from a hand-edited file` to include `profile: 'default'`:

```ts
    expect(new PinsStore(dir).load()).toEqual([
      { url: 'https://ok.test/', title: 'https://ok.test/', favicon: null, profile: 'default' },
    ])
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/pins-store.test.ts`
Expected: FAIL — loaded slots have no `profile` key.

- [ ] **Step 4: Normalize profile in PinsStore.load**

In `src/main/pins-store.ts`, replace the `.map(...)` in `load()`:

```ts
      .map((p) => ({
        url: p.url,
        title: typeof p.title === 'string' ? p.title : p.url,
        favicon: typeof p.favicon === 'string' ? p.favicon : null,
        profile: p.profile === 'work' ? ('work' as const) : ('default' as const),
      }))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/pins-store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/main/pins-store.ts tests/pins-store.test.ts
git commit -m "feat: pin slots carry a profile"
```

---

### Task 3: TabManager profile support

**Files:**
- Modify: `src/main/tab-manager.ts`
- Modify: `src/shared/ipc.ts` (`TabInfo` gains required `profile`)

No Vitest here — `TabManager` is Electron-coupled (repo convention: typecheck + manual smoke). `tab-model.ts` is untouched.

**Interfaces:**
- Consumes: `ProfileId`, `PinSlot.profile` from Tasks 1–2.
- Produces (Task 4 and renderer rely on these exact signatures):
  - `createTab(url?: string, activate?: boolean, profile?: ProfileId): string` (default `'default'`)
  - `setProfile(id: string, profile: ProfileId): void`
  - `profileOf(id: string): ProfileId`
  - `restoreTabs(tabs: { url: string; profile: ProfileId }[], active: number): void`
  - `TabManagerOptions.onTabCreated?(wc: WebContents, profile: ProfileId): void`
  - `TabManagerOptions.onTabActivated?(wc: WebContents, profile: ProfileId): void`
  - `TabInfo.profile: ProfileId`

- [ ] **Step 1: Add profile to TabInfo in src/shared/ipc.ts**

```ts
export interface TabInfo {
  id: string
  title: string
  url: string
  favicon: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isBookmarked: boolean
  isPinned: boolean
  isAsleep: boolean
  pinnedUrl: string | null
  profile: ProfileId
}
```

- [ ] **Step 2: Thread profile through TabManager**

In `src/main/tab-manager.ts`:

Import `ProfileId` (type-only) and add a partition constant below `TOPBAR_HEIGHT`:

```ts
import type { PinSlot, ProfileId, TabInfo, TabsSnapshot } from '../shared/ipc'
```

```ts
export const WORK_PARTITION = 'persist:profile-work'
```

Update the two option callbacks in `TabManagerOptions`:

```ts
  onTabCreated?(wc: WebContents, profile: ProfileId): void
  onTabActivated?(wc: WebContents, profile: ProfileId): void
```

Add a field next to `pins`:

```ts
  private profiles = new Map<string, ProfileId>()
```

Replace `createTab` and `createView` (profile must be set before `createView` so the partition, popup handler, and `onTabCreated` see it):

```ts
  createTab(url?: string, activate = true, profile: ProfileId = 'default'): string {
    const id = `tab-${++this.counter}`
    this.profiles.set(id, profile)
    const view = this.createView(id)
    this.model.add(id, activate)
    if (url) view.webContents.loadURL(classifyInput(url))
    else if (activate) this.focusUrlBar()
    this.syncViews()
    return id
  }

  private createView(id: string): WebContentsView {
    const profile = this.profileOf(id)
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        ...(profile === 'work' ? { partition: WORK_PARTITION } : {}),
      },
    })
    this.views.set(id, view)
    this.favicons.set(id, null)
    this.wireEvents(id, view.webContents)
    this.opts.onTabCreated?.(view.webContents, profile)
    view.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
      // popups (OAuth windows etc.) must land in the opener's container
      if (/^https?:\/\//.test(popupUrl)) this.createTab(popupUrl, true, this.profileOf(id))
      return { action: 'deny' }
    })
    return view
  }
```

Add accessors and the switch, after `togglePin`:

```ts
  profileOf(id: string): ProfileId {
    return this.profiles.get(id) ?? 'default'
  }

  // a WebContents' session is fixed at creation, so switching profile
  // recreates the view in the new partition; the tab keeps its id and
  // sidebar/MRU position, but navigation history resets
  setProfile(id: string, profile: ProfileId): void {
    if (this.profileOf(id) === profile) return
    this.profiles.set(id, profile)
    const slot = this.pins.get(id)
    if (slot) slot.profile = profile
    const view = this.views.get(id)
    if (!view) {
      this.refresh() // asleep pin: the new partition applies on wake
      return
    }
    const url = view.webContents.getURL()
    const wasAttached = this.attached === view
    this.destroyView(id, view, wasAttached)
    const next = this.createView(id)
    if (/^https?:\/\//.test(url)) next.webContents.loadURL(url)
    else if (id === this.model.activeId) this.focusUrlBar()
    this.syncViews()
    if (wasAttached) this.attached?.webContents.focus()
  }
```

In `closeTab`, drop the profile record for real closes. After the `this.destroyView(id, view, wasAttached)` line add:

```ts
    this.profiles.delete(id)
```

(`sleepPin` keeps the entry — a sleeping pin still has a profile.)

In `togglePin`, include the profile when creating the slot:

```ts
      this.pins.set(id, {
        url,
        title: wc.getTitle() || url,
        favicon: this.favicons.get(id) ?? null,
        profile: this.profileOf(id),
      })
```

In `restorePins`, seed the profile map:

```ts
  restorePins(slots: PinSlot[]): void {
    for (const slot of slots) {
      const id = `tab-${++this.counter}`
      this.pins.set(id, { ...slot })
      this.profiles.set(id, slot.profile ?? 'default')
      this.model.addPin(id)
    }
  }
```

Replace `restoreTabs`:

```ts
  // recreate a saved session: tabs in sidebar order, then the active one
  restoreTabs(tabs: { url: string; profile: ProfileId }[], active: number): void {
    if (tabs.length === 0) {
      this.createTab()
      return
    }
    const ids = tabs.map((t) => this.createTab(t.url || undefined, false, t.profile))
    this.activateTab(ids[Math.min(Math.max(active, 0), ids.length - 1)]!)
  }
```

In `syncViews`, pass the profile through:

```ts
      if (active) this.opts.onTabActivated?.(active.webContents, this.profileOf(this.model.activeId!))
```

In `snapshot()`, add `profile: this.profileOf(id)` to BOTH tab-info literals (the live-view branch and the asleep-pin branch).

- [ ] **Step 3: Typecheck-drive the remaining call sites**

Run: `npm run typecheck`
Expected: errors ONLY in `src/main/index.ts` (old `tabsStore.save`/`restoreTabs` shapes — fixed in Task 4). No errors in `tab-manager.ts`, `pins-store.ts`, or the renderer. If `tab-manager.ts` itself errors, fix before committing.

Run: `npm test`
Expected: PASS (pure-module suites unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/main/tab-manager.ts src/shared/ipc.ts
git commit -m "feat: per-tab session profiles in TabManager"
```

---

### Task 4: Main-process wiring — work session, context menu, extension skip

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `WORK_PARTITION` from `tab-manager.ts`; `tabs.setProfile` / `tabs.profileOf` / new `restoreTabs` shape from Task 3; `TabEntry`-shaped `tabsStore.save/load` from Task 1.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Create the Work session and attach downloads**

In `src/main/index.ts`, import `WORK_PARTITION` alongside `TabManager`:

```ts
import { TabManager, WORK_PARTITION } from './tab-manager'
```

After the existing `downloads.attach(session.defaultSession)` line (`index.ts:100`), add:

```ts
  // the Work container: isolated cookies/storage/cache, persisted across runs.
  // No extensions are loaded into it and no webRequest handlers are registered
  // (repo rule). Created eagerly so downloads work before any Work tab exists.
  const workSession = session.fromPartition(WORK_PARTITION)
  downloads.attach(workSession)
```

- [ ] **Step 2: Skip extension registration for Work tabs**

Replace the two callbacks in the `TabManager` options (`index.ts:88-92`). Work tabs are deliberately invisible to `ElectronChromeExtensions` — registering them would expose Work-container URLs to default-session extensions through chrome.tabs:

```ts
    onTabCreated: (wc, profile) => {
      attachCycleHooks(wc)
      if (profile === 'default') extensions.addTab(wc)
    },
    onTabActivated: (wc, profile) => {
      if (profile === 'default') extensions.selectTab(wc)
    },
```

- [ ] **Step 3: Persist profiles in the snapshot handler**

Replace the `tabsStore.save(...)` call inside `onSnapshot` (`index.ts:74-77`):

```ts
      tabsStore.save(
        snap.order.map((id) => ({ url: snap.tabs[id]!.url, profile: snap.tabs[id]!.profile })),
        snap.activeId ? snap.order.indexOf(snap.activeId) : -1,
      )
```

And add `profile` to the `pinsStore.save` mapping (`index.ts:78-84`):

```ts
      pinsStore.save(
        snap.pinned.map((id) => ({
          url: snap.tabs[id]!.pinnedUrl ?? snap.tabs[id]!.url,
          title: snap.tabs[id]!.title,
          favicon: snap.tabs[id]!.favicon,
          profile: snap.tabs[id]!.profile,
        })),
      )
```

- [ ] **Step 4: Add the Profile submenu to the tab context menu**

Replace the body of the `tabs:context-menu` handler (`index.ts:113-131`):

```ts
  ipcMain.on('tabs:context-menu', (_e, id: string) => {
    if (typeof id !== 'string') return
    const pinned = tabs.isPinned(id)
    const profile = tabs.profileOf(id)
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: pinned ? 'Unpin Tab' : 'Pin Tab',
        click: () => tabs.togglePin(id),
      },
    ]
    if (pinned && tabs.isAwake(id)) {
      template.push({ label: 'Restore Pinned URL', click: () => tabs.restorePinnedUrl(id) })
    }
    template.push(
      { type: 'separator' },
      {
        label: 'Profile',
        submenu: [
          {
            label: 'Default',
            type: 'radio',
            checked: profile === 'default',
            click: () => tabs.setProfile(id, 'default'),
          },
          {
            label: 'Work',
            type: 'radio',
            checked: profile === 'work',
            click: () => tabs.setProfile(id, 'work'),
          },
        ],
      },
      { type: 'separator' },
      // closing a pin puts it to sleep; the slot stays in the row
      { label: pinned ? 'Close' : 'Close Tab', click: () => tabs.closeTab(id) },
    )
    Menu.buildFromTemplate(template).popup({ window: win })
  })
```

- [ ] **Step 5: Restore with profiles**

Replace the restore lines at the end of startup (`index.ts:166-167`):

```ts
  const saved = tabsStore.load()
  tabs.restoreTabs(saved.tabs, saved.active)
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: clean, zero errors (this closes the gap left open in Tasks 1 and 3).

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: work profile session, context-menu assignment, extension isolation"
```

---

### Task 5: Renderer profile indicator

**Files:**
- Modify: `src/renderer/sidebar.ts`
- Modify: `src/renderer/style.css`

**Interfaces:**
- Consumes: `TabInfo.profile` from Task 3 (already in every snapshot).
- Produces: nothing for later tasks. Renderer stays a pure function of the snapshot.

- [ ] **Step 1: Render the Work dot in the tab list**

In `renderTabList` in `src/renderer/sidebar.ts`, replace the append line:

```ts
    item.append(icon, title, close)
```

with:

```ts
    if (tab.profile === 'work') {
      const dot = document.createElement('span')
      dot.className = 'profile-dot'
      dot.title = 'Work profile'
      item.append(icon, title, dot, close)
    } else {
      item.append(icon, title, close)
    }
```

- [ ] **Step 2: Mark Work pins**

In `renderPins`, replace the `btn.className` line:

```ts
    btn.className =
      'pin' +
      (id === snap.activeId ? ' active' : '') +
      (tab.isAsleep ? ' asleep' : '') +
      (tab.profile === 'work' ? ' work' : '')
```

- [ ] **Step 3: Styles**

In `src/renderer/style.css`, add `--work: #e0af68;` to `:root`, and append after the `.tab-close:hover` rule:

```css
.profile-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--work);
}
.pin.work {
  box-shadow: inset 0 0 0 1.5px var(--work);
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck` → clean. Run: `npm test` → PASS.

```bash
git add src/renderer/sidebar.ts src/renderer/style.css
git commit -m "feat: work-profile indicator in sidebar"
```

---

### Task 6: Full verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Full automated pass**

```bash
npm run typecheck && npm test
```

Expected: zero type errors; all Vitest suites pass.

- [ ] **Step 2: Manual smoke (npm run dev)**

Walk this checklist; every line must hold before the feature is done:

1. Right-click a tab → Profile submenu shows radio Default/Work with Default checked.
2. Open gmail.com, log in (account A). Open a second gmail.com tab, right-click → Profile → Work. The tab reloads logged-out; log in as account B. Both tabs now show different inboxes side by side.
3. Work tab shows the amber dot in the sidebar; switching it back to Default removes the dot (and logs it back into account A's session).
4. Quit and relaunch: both tabs restore, the Work tab still shows the dot AND account B is still logged in (partition persisted).
5. Pin the Work tab → pin button gets the amber ring; close it (sleeps), click to wake → wakes in the Work container (still account B).
6. From the Work Gmail, trigger a popup (e.g. print preview or an OAuth link) → the popup tab is also Work (dot present).
7. Extensions: browser-action buttons act on Default tabs; on a Work tab, content scripts/ad-blocking are absent (expected v1 behavior). Tab cycling (Ctrl+Tab / Option+Tab) still works from a Work tab.
8. Download a file from a Work tab → download pill appears and completes.

- [ ] **Step 3: Update REPO_RULES architecture notes**

Append to the Architecture section of `.agents/REPO_RULES.md`:

```markdown
- Tabs can belong to a session container ("profile"): Default (default session) or
  Work (persist:profile-work partition). Switching recreates the WebContentsView —
  a WebContents' session is fixed at creation. Work tabs are deliberately NOT
  registered with ElectronChromeExtensions (no extensions in the Work session, and
  registering them would leak Work URLs to default-session extensions via chrome.tabs).
```

- [ ] **Step 4: Commit**

```bash
git add .agents/REPO_RULES.md
git commit -m "docs: tab profile architecture notes"
```
