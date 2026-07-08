# Find in Page + Sparkle Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cmd+F find-in-page with highlight-all and Cmd+G / Cmd+Shift+G stepping, plus Sparkle-protocol auto-update (appcast + EdDSA-verified DMG, reusing synapse-commander's signing key). Ships as 0.3.1.

**Architecture:** Find sessions live in main (`TabManager` wraps `webContents.findInPage`); the renderer owns the find-bar UI and last-query state, so menu Find Next with a closed bar can re-open it. The updater speaks Sparkle's protocol in TypeScript: an Electron-free appcast parser + `node:crypto` ed25519 verification pinned to the shared public key; downloads are verified before ever touching disk and installs are guided (open the DMG), never self-replacing.

**Tech Stack:** Electron 43, TypeScript strict, Vitest, vanilla DOM, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-08-find-and-sparkle-design.md`

## Global Constraints

- TypeScript strict; `npm run typecheck` must pass before any task is done.
- No new npm dependencies; no UI framework; pure logic in `src/shared/` (or pure-Node in `src/main/`) with Vitest coverage in `tests/`.
- Short conventional commits.
- Registry command ids exactly: `find`, `find-next`, `find-prev` with defaults `CmdOrCtrl+F`, `CmdOrCtrl+G`, `CmdOrCtrl+Shift+G`.
- IPC channels exactly: `find:start`, `find:step`, `find:stop`, `ui:find-open`, `ui:find-step`, `ui:find-result`.
- Public key constant exactly `Tnoq0NNryfeGcjS0eQ2xfuOuvqf4dRoa3wF86ljVZh4=`; feed URL exactly `https://raw.githubusercontent.com/dep/synapse-browser/main/appcast.xml`; env overrides `SYNAPSE_APPCAST_URL` / `SYNAPSE_SU_PUBLIC_KEY`.

---

### Task 1: Appcast parser (shared)

**Files:**
- Create: `src/shared/appcast.ts`
- Test: `tests/appcast.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AppcastItem { version: string; shortVersion: string; pubDate: string; notesHtml: string | null; url: string; edSignature: string; length: number }`, `parseAppcast(xml: string): AppcastItem[]`, `compareVersions(a: string, b: string): number`, `pickUpdate(items: AppcastItem[], current: string): AppcastItem | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/appcast.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { compareVersions, parseAppcast, pickUpdate } from '../src/shared/appcast'

const FEED = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Synapse Browser</title>
    <item>
      <title>Version 0.4.0</title>
      <pubDate>Wed, 08 Jul 2026 12:00:00 +0000</pubDate>
      <sparkle:version>0.4.0</sparkle:version>
      <sparkle:shortVersionString>0.4.0</sparkle:shortVersionString>
      <description><![CDATA[<ul><li>Big stuff</li></ul>]]></description>
      <enclosure
        url="https://github.com/dep/synapse-browser/releases/download/0.4.0/Synapse.Browser-0.4.0-universal.dmg"
        sparkle:edSignature="c2lnbmF0dXJl"
        length="12345"
        type="application/octet-stream" />
    </item>
    <item>
      <title>Version 0.3.1</title>
      <pubDate>Tue, 07 Jul 2026 12:00:00 +0000</pubDate>
      <sparkle:version>0.3.1</sparkle:version>
      <sparkle:shortVersionString>0.3.1</sparkle:shortVersionString>
      <enclosure url="https://example.com/0.3.1.dmg" sparkle:edSignature="b2xk" length="99" type="application/octet-stream" />
    </item>
    <item>
      <title>Broken — no enclosure</title>
      <sparkle:version>9.9.9</sparkle:version>
    </item>
  </channel>
</rss>`

describe('parseAppcast', () => {
  it('parses items with enclosures and skips malformed ones', () => {
    const items = parseAppcast(FEED)
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      version: '0.4.0',
      shortVersion: '0.4.0',
      pubDate: 'Wed, 08 Jul 2026 12:00:00 +0000',
      notesHtml: '<ul><li>Big stuff</li></ul>',
      url: 'https://github.com/dep/synapse-browser/releases/download/0.4.0/Synapse.Browser-0.4.0-universal.dmg',
      edSignature: 'c2lnbmF0dXJl',
      length: 12345,
    })
    expect(items[1]?.notesHtml).toBeNull()
  })

  it('returns [] for non-feed input', () => {
    expect(parseAppcast('')).toEqual([])
    expect(parseAppcast('not xml at all')).toEqual([])
  })
})

describe('compareVersions', () => {
  it('orders dotted versions numerically', () => {
    expect(compareVersions('0.3.1', '0.3.0')).toBe(1)
    expect(compareVersions('0.3.0', '0.3.1')).toBe(-1)
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
  })
})

describe('pickUpdate', () => {
  it('picks the newest item strictly newer than current', () => {
    const items = parseAppcast(FEED)
    expect(pickUpdate(items, '0.3.0')?.shortVersion).toBe('0.4.0')
    expect(pickUpdate(items, '0.3.1')?.shortVersion).toBe('0.4.0')
    expect(pickUpdate(items, '0.4.0')).toBeNull()
    expect(pickUpdate(items, '1.0.0')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/appcast.test.ts`
Expected: FAIL — cannot resolve `../src/shared/appcast`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/appcast.ts`:

```typescript
// minimal parser for Sparkle appcast feeds — tolerant of unknown tags,
// skips items without a usable enclosure
export interface AppcastItem {
  version: string
  shortVersion: string
  pubDate: string
  notesHtml: string | null
  url: string
  edSignature: string
  length: number
}

export function parseAppcast(xml: string): AppcastItem[] {
  const items: AppcastItem[] = []
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1]!
    const enclosure = /<enclosure\b([\s\S]*?)\/>/.exec(block)?.[1]
    if (!enclosure) continue
    const attr = (name: string): string | null =>
      new RegExp(`${name}="([^"]*)"`).exec(enclosure)?.[1] ?? null
    const tag = (name: string): string | null =>
      new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1]?.trim() ?? null
    const url = attr('url')
    const edSignature = attr('sparkle:edSignature')
    const version = tag('sparkle:version')
    if (!url || !edSignature || !version) continue
    const cdata = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(block)
    items.push({
      version,
      shortVersion: tag('sparkle:shortVersionString') ?? version,
      pubDate: tag('pubDate') ?? '',
      notesHtml: cdata?.[1]?.trim() ?? null,
      url,
      edSignature,
      length: Number(attr('length') ?? 0) || 0,
    })
  }
  return items
}

export function compareVersions(a: string, b: string): number {
  const as = a.split('.').map((n) => parseInt(n, 10) || 0)
  const bs = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const d = (as[i] ?? 0) - (bs[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

export function pickUpdate(items: AppcastItem[], current: string): AppcastItem | null {
  let best: AppcastItem | null = null
  for (const item of items) {
    if (compareVersions(item.shortVersion, current) <= 0) continue
    if (!best || compareVersions(item.shortVersion, best.shortVersion) > 0) best = item
  }
  return best
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/appcast.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/appcast.ts tests/appcast.test.ts
git commit -m "feat: sparkle appcast parsing and update picking"
```

---

### Task 2: ed25519 verification (pure Node)

**Files:**
- Create: `src/main/ed25519.ts`
- Test: `tests/ed25519.test.ts`

**Interfaces:**
- Consumes: `node:crypto` only (no Electron).
- Produces: `verifyEd25519(data: Buffer, signatureB64: string, publicKeyB64: string): boolean` — never throws.

- [ ] **Step 1: Write the failing test**

Create `tests/ed25519.test.ts`:

```typescript
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyEd25519 } from '../src/main/ed25519'

// raw 32-byte public key = last 32 bytes of the SPKI DER export
function keypair(): { publicB64: string; sign: (data: Buffer) => string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' })
  return {
    publicB64: Buffer.from(spki.subarray(spki.byteLength - 32)).toString('base64'),
    sign: (data) => cryptoSign(null, data, privateKey).toString('base64'),
  }
}

describe('verifyEd25519', () => {
  it('verifies a valid signature (sparkle sign_update format: raw key + raw sig, base64)', () => {
    const { publicB64, sign } = keypair()
    const data = Buffer.from('this is a dmg, trust me')
    expect(verifyEd25519(data, sign(data), publicB64)).toBe(true)
  })

  it('rejects tampered data and foreign signatures', () => {
    const a = keypair()
    const b = keypair()
    const data = Buffer.from('payload')
    expect(verifyEd25519(Buffer.from('payloax'), a.sign(data), a.publicB64)).toBe(false)
    expect(verifyEd25519(data, b.sign(data), a.publicB64)).toBe(false)
  })

  it('returns false (not throw) on malformed inputs', () => {
    const { publicB64, sign } = keypair()
    const data = Buffer.from('x')
    expect(verifyEd25519(data, 'not base64!!!', publicB64)).toBe(false)
    expect(verifyEd25519(data, sign(data), 'dG9vc2hvcnQ=')).toBe(false)
    expect(verifyEd25519(data, '', '')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ed25519.test.ts`
Expected: FAIL — cannot resolve `../src/main/ed25519`.

- [ ] **Step 3: Write the implementation**

Create `src/main/ed25519.ts`:

```typescript
import { createPublicKey, verify as cryptoVerify } from 'node:crypto'

// raw 32-byte ed25519 public keys (Sparkle's SUPublicEDKey format) need the
// ASN.1 SPKI header prepended before node:crypto can import them
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export function verifyEd25519(data: Buffer, signatureB64: string, publicKeyB64: string): boolean {
  try {
    const raw = Buffer.from(publicKeyB64, 'base64')
    if (raw.byteLength !== 32) return false
    const sig = Buffer.from(signatureB64, 'base64')
    if (sig.byteLength !== 64) return false
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    })
    return cryptoVerify(null, data, key, sig)
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ed25519.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/ed25519.ts tests/ed25519.test.ts
git commit -m "feat: ed25519 verification for sparkle-signed updates"
```

---

### Task 3: Find commands in the shortcuts registry

**Files:**
- Modify: `src/shared/shortcuts.ts`
- Modify: `tests/shortcuts.test.ts`

**Interfaces:**
- Consumes: existing `SHORTCUT_COMMANDS`.
- Produces: registry entries `find` (CmdOrCtrl+F), `find-next` (CmdOrCtrl+G), `find-prev` (CmdOrCtrl+Shift+G). Task 5's menu reads `shortcuts['find']` etc.

- [ ] **Step 1: Extend the failing test**

In `tests/shortcuts.test.ts`, inside the `it('returns every command default when no overrides', ...)` test, add after the existing assertions:

```typescript
    expect(resolved['find']).toBe('CmdOrCtrl+F')
    expect(resolved['find-next']).toBe('CmdOrCtrl+G')
    expect(resolved['find-prev']).toBe('CmdOrCtrl+Shift+G')
```

Run: `npx vitest run tests/shortcuts.test.ts` — expected FAIL (undefined).

- [ ] **Step 2: Add the registry entries**

In `src/shared/shortcuts.ts`, in `SHORTCUT_COMMANDS`, insert after the `forward` entry:

```typescript
  { id: 'find', label: 'Find…', default: 'CmdOrCtrl+F' },
  { id: 'find-next', label: 'Find Next', default: 'CmdOrCtrl+G' },
  { id: 'find-prev', label: 'Find Previous', default: 'CmdOrCtrl+Shift+G' },
```

- [ ] **Step 3: Verify**

Run: `npx vitest run tests/shortcuts.test.ts && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 4: Commit**

```bash
git add src/shared/shortcuts.ts tests/shortcuts.test.ts
git commit -m "feat: find command registry entries"
```

---

### Task 4: TabManager find session

**Files:**
- Modify: `src/main/tab-manager.ts`

**Interfaces:**
- Consumes: existing `attached`, `wireEvents`, `syncViews`.
- Produces: `TabManager.findStart(text: string): void`, `findStep(dir: 1 | -1): void`, `findStop(): void`; `TabManagerOptions.onFindResult?(result: { matches: number; active: number }): void`. Task 5 wires these.

- [ ] **Step 1: Options + session state**

In `src/main/tab-manager.ts` add to `TabManagerOptions`:

```typescript
onFindResult?(result: { matches: number; active: number }): void
```

Add a field near `overlayHeight`:

```typescript
private findText = ''
```

- [ ] **Step 2: Session methods**

Next to `zoomActive` add:

```typescript
// find sessions live on the attached (active) view; switching tabs ends them
findStart(text: string): void {
  const wc = this.attached?.webContents
  if (!wc) return
  if (!text) {
    this.findStop()
    return
  }
  this.findText = text
  wc.findInPage(text)
}

findStep(dir: 1 | -1): void {
  const wc = this.attached?.webContents
  if (!wc || !this.findText) return
  wc.findInPage(this.findText, { findNext: true, forward: dir === 1 })
}

findStop(): void {
  this.findText = ''
  this.attached?.webContents.stopFindInPage('clearSelection')
}
```

- [ ] **Step 3: Result events + stop-on-switch**

In `wireEvents(id, wc)` add alongside the other listeners:

```typescript
wc.on('found-in-page', (_e, result) => {
  // only the attached view's session is live; ignore stragglers
  if (this.attached?.webContents === wc) {
    this.opts.onFindResult?.({ matches: result.matches, active: result.activeMatchOrdinal })
  }
})
```

In `syncViews()`, inside the `if (this.attached !== active) {` block, BEFORE the existing removeChildView line, add:

```typescript
if (this.attached && this.findText) {
  this.attached.webContents.stopFindInPage('clearSelection')
  this.findText = ''
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`
Expected: both clean (Electron-coupled; runtime verified by smoke).

- [ ] **Step 5: Commit**

```bash
git add src/main/tab-manager.ts
git commit -m "feat: find-in-page session management in tab-manager"
```

---

### Task 5: Find IPC + menu + find bar UI

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/menu.ts`
- Create: `src/renderer/find-bar.ts`
- Modify: `src/renderer/index.html`, `src/renderer/main.ts`, `src/renderer/style.css`

**Interfaces:**
- Consumes: Task 3 registry ids, Task 4 TabManager methods.
- Produces: `SynapseApi.find { start(text: string): void; step(dir: 1 | -1): void; stop(): void }`; `SynapseApi.ui.onFindOpen(cb: () => void)`, `onFindStep(cb: (dir: 1 | -1) => void)`, `onFindResult(cb: (r: { matches: number; active: number }) => void)`; renderer `initFindBar(): FindBar` with `update(snap)`.

- [ ] **Step 1: Shared types**

In `src/shared/ipc.ts` add to `SynapseApi` after the `shortcuts` block:

```typescript
find: {
  start(text: string): void
  step(dir: 1 | -1): void
  stop(): void
}
```

And to the `ui` block after `onSettings`:

```typescript
onFindOpen(cb: () => void): void
onFindStep(cb: (dir: 1 | -1) => void): void
onFindResult(cb: (r: { matches: number; active: number }) => void): void
```

- [ ] **Step 2: Preload**

In `src/preload/index.ts` add after the `shortcuts` object:

```typescript
find: {
  start: (text) => ipcRenderer.send('find:start', text),
  step: (dir) => ipcRenderer.send('find:step', dir),
  stop: () => ipcRenderer.send('find:stop'),
},
```

And in `ui` after `onSettings`:

```typescript
onFindOpen: (cb) => {
  ipcRenderer.on('ui:find-open', () => cb())
},
onFindStep: (cb) => {
  ipcRenderer.on('ui:find-step', (_e, dir) => cb(dir))
},
onFindResult: (cb) => {
  ipcRenderer.on('ui:find-result', (_e, r) => cb(r))
},
```

- [ ] **Step 3: Main handlers + result push**

In `src/main/index.ts`, next to the `ui:sidebar-drag-*` handlers add:

```typescript
ipcMain.on('find:start', (_e, text: string) => {
  if (typeof text === 'string') tabs.findStart(text)
})
ipcMain.on('find:step', (_e, dir: number) => tabs.findStep(dir === -1 ? -1 : 1))
ipcMain.on('find:stop', () => tabs.findStop())
```

In the `TabManager` options literal add:

```typescript
onFindResult: (r) => win.webContents.send('ui:find-result', r),
```

- [ ] **Step 4: Menu items**

In `src/main/menu.ts`, in the View submenu after the `Forward` item (before the zoom separator), add:

```typescript
{ type: 'separator' },
{
  label: 'Find…',
  accelerator: shortcuts['find'],
  click: () => win.webContents.send('ui:find-open'),
},
{
  label: 'Find Next',
  accelerator: shortcuts['find-next'],
  click: () => win.webContents.send('ui:find-step', 1),
},
{
  label: 'Find Previous',
  accelerator: shortcuts['find-prev'],
  click: () => win.webContents.send('ui:find-step', -1),
},
```

- [ ] **Step 5: Renderer find bar**

Create `src/renderer/find-bar.ts`:

```typescript
import type { TabsSnapshot } from '../shared/ipc'

export interface FindBar {
  update(snap: TabsSnapshot): void
}

// the bar lives in the topbar row, so it never fights the page view for
// space; main owns the find session, this module owns bar state + last query
export function initFindBar(): FindBar {
  const bar = document.getElementById('find-bar') as HTMLDivElement
  const input = document.getElementById('find-input') as HTMLInputElement
  const count = document.getElementById('find-count') as HTMLSpanElement
  const prev = document.getElementById('find-prev') as HTMLButtonElement
  const next = document.getElementById('find-next') as HTMLButtonElement
  const close = document.getElementById('find-close') as HTMLButtonElement
  let activeId: string | null = null
  let lastQuery = ''

  function open(): void {
    bar.hidden = false
    input.focus()
    input.select()
  }

  function closeBar(): void {
    if (bar.hidden) return
    bar.hidden = true
    count.textContent = ''
    window.synapse.find.stop()
  }

  function step(dir: 1 | -1): void {
    if (bar.hidden) {
      // Cmd+G with a closed bar re-opens the last search (macOS convention)
      if (!lastQuery) return
      open()
      input.value = lastQuery
      window.synapse.find.start(lastQuery)
      return
    }
    window.synapse.find.step(dir)
  }

  window.synapse.ui.onFindOpen(() => open())
  window.synapse.ui.onFindStep((dir) => step(dir))
  window.synapse.ui.onFindResult(({ matches, active }) => {
    if (bar.hidden) return
    count.textContent = `${matches > 0 ? active : 0} of ${matches}`
    count.classList.toggle('empty', matches === 0)
  })

  input.addEventListener('input', () => {
    lastQuery = input.value
    if (input.value) {
      window.synapse.find.start(input.value)
    } else {
      count.textContent = ''
      window.synapse.find.stop()
    }
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') step(e.shiftKey ? -1 : 1)
    else if (e.key === 'Escape') closeBar()
  })
  prev.addEventListener('click', () => step(-1))
  next.addEventListener('click', () => step(1))
  close.addEventListener('click', () => closeBar())

  return {
    update(snap) {
      if (snap.activeId !== activeId) {
        activeId = snap.activeId
        closeBar()
      }
    },
  }
}
```

- [ ] **Step 6: HTML, wiring, CSS**

In `src/renderer/index.html`, inside `#topbar` after the `download-pill` button:

```html
<div id="find-bar" hidden>
  <input id="find-input" type="text" placeholder="Find in page" spellcheck="false" />
  <span id="find-count"></span>
  <button id="find-prev" title="Previous match (Shift+Enter)">‹</button>
  <button id="find-next" title="Next match (Enter)">›</button>
  <button id="find-close" title="Close (Esc)">×</button>
</div>
```

In `src/renderer/main.ts`: add `import { initFindBar } from './find-bar'`; after `const topbar = initTopbar()` add `const findBar = initFindBar()`; in `render()` after `topbar.update(snap)` add `findBar.update(snap)`.

Append to `src/renderer/style.css`:

```css
#find-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg);
  border-radius: 8px;
  padding: 2px 6px;
}
#find-bar[hidden] {
  display: none;
}
#find-input {
  width: 160px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--bg-raised);
  color: var(--fg);
  outline: none;
  font-size: 12px;
}
#find-input:focus {
  border-color: var(--accent);
}
#find-count {
  color: var(--fg-dim);
  font-size: 11px;
  min-width: 52px;
  text-align: center;
  white-space: nowrap;
}
#find-count.empty {
  color: #f7768e;
}
#topbar #find-bar button {
  width: 22px;
  height: 22px;
  font-size: 13px;
}
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/index.ts src/main/menu.ts src/renderer/find-bar.ts src/renderer/index.html src/renderer/main.ts src/renderer/style.css
git commit -m "feat: find-in-page bar with Cmd+F/G/Shift+G"
```

---

### Task 6: Updater

**Files:**
- Create: `src/shared/update-config.ts`
- Create: `src/main/updater.ts`
- Modify: `src/main/index.ts`, `src/main/menu.ts`

**Interfaces:**
- Consumes: Task 1's `parseAppcast`/`pickUpdate`, Task 2's `verifyEd25519`.
- Produces: `class Updater` with `constructor(win: BrowserWindow)` and `check(interactive: boolean): Promise<void>`; `MenuCommands.checkForUpdates(): void`.

- [ ] **Step 1: Config constants**

Create `src/shared/update-config.ts`:

```typescript
// Sparkle-protocol update feed. The public key is the same EdDSA key that
// signs synapse-commander updates (one key, both apps); the private half
// lives only in the login keychain of the release machine.
export const APPCAST_URL = 'https://raw.githubusercontent.com/dep/synapse-browser/main/appcast.xml'
export const SU_PUBLIC_KEY = 'Tnoq0NNryfeGcjS0eQ2xfuOuvqf4dRoa3wF86ljVZh4='
```

- [ ] **Step 2: Updater class**

Create `src/main/updater.ts`:

```typescript
import { app, dialog, net, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAppcast, pickUpdate } from '../shared/appcast'
import type { AppcastItem } from '../shared/appcast'
import { APPCAST_URL, SU_PUBLIC_KEY } from '../shared/update-config'
import { verifyEd25519 } from './ed25519'

// speaks Sparkle's protocol (appcast + EdDSA-signed enclosures) without the
// native framework: fetch feed → compare versions → download → verify with
// the pinned public key → open the DMG for a guided install. Never
// self-replaces the app bundle and never executes what it downloads.
export class Updater {
  private busy = false

  constructor(private win: BrowserWindow) {}

  async check(interactive: boolean): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await this.run(interactive)
    } catch (err) {
      console.error('updater: check failed', err)
      if (interactive) {
        void dialog.showMessageBox(this.win, {
          type: 'error',
          message: 'Could not check for updates.',
          detail: String(err),
        })
      }
    } finally {
      this.busy = false
    }
  }

  private async run(interactive: boolean): Promise<void> {
    const feedUrl = process.env['SYNAPSE_APPCAST_URL'] || APPCAST_URL
    const res = await net.fetch(feedUrl, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`appcast HTTP ${res.status}`)
    const item = pickUpdate(parseAppcast(await res.text()), app.getVersion())
    if (!item) {
      if (interactive) {
        void dialog.showMessageBox(this.win, {
          type: 'info',
          message: "You're up to date.",
          detail: `Synapse Browser ${app.getVersion()} is the latest version.`,
        })
      }
      return
    }
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'info',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Synapse Browser ${item.shortVersion} is available.`,
      detail: stripHtml(item.notesHtml ?? '') || 'A new version is available.',
    })
    if (response !== 0) return
    // from here on the user asked for it — failures always surface
    try {
      await this.download(item)
    } catch (err) {
      console.error('updater: download failed', err)
      void dialog.showMessageBox(this.win, {
        type: 'error',
        message: 'Update could not be verified.',
        detail: `${String(err)}\n\nNothing was installed.`,
      })
    }
  }

  private async download(item: AppcastItem): Promise<void> {
    const res = await net.fetch(item.url, { signal: AbortSignal.timeout(300_000) })
    if (!res.ok) throw new Error(`download HTTP ${res.status}`)
    const data = Buffer.from(await res.arrayBuffer())
    if (item.length > 0 && data.byteLength !== item.length) {
      throw new Error(`size mismatch: got ${data.byteLength} bytes, appcast says ${item.length}`)
    }
    const publicKey = process.env['SYNAPSE_SU_PUBLIC_KEY'] || SU_PUBLIC_KEY
    if (!verifyEd25519(data, item.edSignature, publicKey)) {
      throw new Error('EdDSA signature did not verify')
    }
    const file = join(app.getPath('temp'), `SynapseBrowser-${item.shortVersion}.dmg`)
    writeFileSync(file, data)
    await shell.openPath(file)
    void dialog.showMessageBox(this.win, {
      type: 'info',
      message: 'Update downloaded and verified.',
      detail:
        'Quit Synapse Browser, drag the new version into Applications, then relaunch.',
    })
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 3: Menu + boot wiring**

In `src/main/menu.ts`: add `checkForUpdates(): void` to `MenuCommands`; in the Tools submenu after the `Settings…` item add:

```typescript
{ label: 'Check for Updates…', click: () => commands.checkForUpdates() },
```

In `src/main/index.ts`: import `Updater` from `./updater`; after the `sidebarResize` construction add:

```typescript
const updater = new Updater(win)
// silent launch check; dev builds check only via the menu
if (app.isPackaged) setTimeout(() => void updater.check(false), 10_000)
```

In `rebuildMenu`'s commands object add:

```typescript
checkForUpdates: () => void updater.check(true),
```

(NOTE: `rebuildMenu` is declared after `updater` must exist — place the `updater` construction before the `rebuildMenu` block; both are after `tabs`.)

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/update-config.ts src/main/updater.ts src/main/index.ts src/main/menu.ts
git commit -m "feat: sparkle-protocol update checker with EdDSA verification"
```

---

### Task 7: Verification sweep

- [ ] **Step 1:** `npm run typecheck && npm test && npm run build` — all clean.
- [ ] **Step 2:** Boot the app; scripted smoke: find on example.com (highlight count, Cmd+G stepping, Esc close), updater manual check against a local appcast + throwaway key via `SYNAPSE_APPCAST_URL` / `SYNAPSE_SU_PUBLIC_KEY`.
- [ ] **Step 3:** Commit any fixes.

---

### Task 8: Release 0.3.1

- [ ] Bump `package.json` to 0.3.1; commit; build notarized DMG (`APPLE_KEYCHAIN_PROFILE=notarytool npm run dist:mac`).
- [ ] `gh release create 0.3.1` with notes + DMG; read back the served asset URL.
- [ ] `/tmp/sparkle-bin/bin/sign_update <dmg>` → create `appcast.xml` at repo root (commander item shape, both version fields = semver, minimumSystemVersion omitted or 14.0) with the real asset URL, signature, length.
- [ ] Commit appcast + tag 0.3.1 + push (feed serves from main).
