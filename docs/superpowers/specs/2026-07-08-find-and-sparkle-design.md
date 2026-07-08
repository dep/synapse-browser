# Find in Page + Sparkle-Protocol Updates — Design

2026-07-08. Status: approved (autonomous run; design decisions by agent per user
instruction). Ships as 0.3.1.

## 1. Find in page (Cmd+F / Cmd+G / Cmd+Shift+G)

### UX

- Cmd+F reveals a find bar at the right end of the topbar (row 1 — no overlay
  games needed; page views only cover the area below the topbar) and focuses
  its input. If already open, Cmd+F re-focuses and selects the query.
- Typing searches as you type; all matches highlight (Chromium's built-in
  `findInPage` behavior), the active match gets the emphasis ring, and the bar
  shows `N of M` (or `0 of 0` styled dim).
- Cmd+G / Enter → next match; Cmd+Shift+G / Shift+Enter → previous.
- Esc (in the input) or the ✕ button closes the bar and clears highlights
  (`stopFindInPage('clearSelection')`).
- Switching or closing the active tab stops the find session and closes the bar.
- Cmd+G / Cmd+Shift+G while the bar is closed re-open it with the last query
  (matches macOS convention); no-op when there is no active page or query.

### Architecture

- All three chords are registry commands (`find`, `find-next`, `find-prev`) —
  automatically re-recordable and listed in Settings → Keyboard Shortcuts.
  Menu items live under View (Find…, Find Next, Find Previous).
- Main owns the find session (it must call `webContents.findInPage` on the
  active view). `TabManager` gains:
  - `findStart(text: string)` — `findInPage(text)` on the active view
    (`findNext: false` semantics: new session).
  - `findStep(dir: 1 | -1)` — `findInPage(lastText, { findNext: true,
    forward: dir === 1 })`.
  - `findStop()` — `stopFindInPage('clearSelection')`, clears session state.
  - a `found-in-page` listener per tab (wired in `wireEvents`) pushing
    `{ matches, activeMatchOrdinal }` via a new `onFindResult` option callback.
  - Sessions implicitly end on tab switch (`syncViews` calls `findStop()` when
    the attached view changes) and on `closeTab` of the session's tab.
- IPC:
  - renderer → main: `find:start` (text), `find:step` (dir), `find:stop`.
  - main → renderer: `ui:find-result` `{ matches: number, active: number }`,
    `ui:find-open` (menu command → renderer shows/focuses the bar; carries no
    payload — the renderer keeps the last query locally).
- Renderer: `#find-bar` in the topbar (input, `N of M` count, prev/next/✕
  buttons), hidden by default. Vanilla DOM in `topbar.ts` territory but split
  into `src/renderer/find-bar.ts` for focus.

### Edge cases

- No active page view (settings open, asleep slot): `find:*` no-ops in main.
- Empty query: treated as stop (clears highlights, count shows nothing).
- `found-in-page` results for stale request ids are ignored (Electron delivers
  final results per request; renderer just renders the latest push).

## 2. Sparkle-protocol auto-update

### Why not Sparkle.framework itself

Sparkle is a native macOS framework; embedding it in an Electron app requires a
native bridge (objc addon or helper binary) — the repo forbids native build
steps and new runtime dependencies. Instead the app speaks Sparkle's *protocol*:
the same `appcast.xml` format, the same EdDSA (ed25519) enclosure signatures,
verified with Node's built-in `node:crypto`. The release pipeline reuses
synapse-commander's exact signing key, so one key signs both apps' updates.

### Feed & key

- Appcast: `appcast.xml` at the repo root of dep/synapse-browser, served from
  `https://raw.githubusercontent.com/dep/synapse-browser/main/appcast.xml`
  (same pattern as commander).
- Public key (SUPublicEDKey, same key as commander):
  `Tnoq0NNryfeGcjS0eQ2xfuOuvqf4dRoa3wF86ljVZh4=` — baked into
  `src/shared/update-config.ts` as a constant beside the feed URL.
- Dev/test overrides: env `SYNAPSE_APPCAST_URL` and `SYNAPSE_SU_PUBLIC_KEY`
  replace feed and key (lets smoke tests run against a local appcast signed
  with a throwaway key).
- Enclosure signature: ed25519 over the raw DMG bytes, base64 (exactly what
  Sparkle's `sign_update` emits); `length` must match the downloaded size.

### Client flow

- `src/shared/appcast.ts` (Electron-free, Vitest-covered):
  - `parseAppcast(xml: string): AppcastItem[]` — minimal tolerant parser for
    the known appcast shape (`<item>` blocks; extracts `sparkle:version`,
    `sparkle:shortVersionString`, `pubDate`, CDATA description, enclosure
    `url` / `sparkle:edSignature` / `length`). Malformed items are skipped.
  - `compareVersions(a, b)` — numeric dotted-segment compare.
  - `pickUpdate(items, currentVersion)` — newest item strictly newer than
    current, or null.
- `src/main/ed25519.ts` (pure Node, Vitest-covered):
  `verifyEd25519(data: Buffer, signatureB64: string, publicKeyB64: string):
  boolean` — wraps the raw 32-byte key in the SPKI DER prefix and uses
  `crypto.verify(null, …)`.
- `src/main/updater.ts` (Electron-coupled orchestrator):
  - `checkForUpdates(interactive: boolean)`: fetch appcast (Electron
    `net.fetch`, 15s abort) → parse → `pickUpdate(items, app.getVersion())`.
    - No update: interactive → "You're up to date" box; silent → nothing.
    - Fetch/parse failure: interactive → error box; silent → `console.error`.
  - Update found: dialog (release title + plain-texted notes) with
    "Download" / "Later". Download to `app.getPath('temp')` via `net.fetch`
    → check `length` → `verifyEd25519` with the pinned key. Any mismatch →
    delete file + error box ("signature did not verify; not installing").
    Success → `shell.openPath(dmg)` + box explaining: quit the app and drag
    the new version to Applications (guided install — v1 deliberately does
    not self-replace the bundle; noted as follow-up).
  - Boot check: 10s after ready, silent, only when `app.isPackaged` (dev runs
    check only via the menu). Single-flight guard (ignore re-entry while a
    check/download runs).
- Menu: Tools → "Check for Updates…" (not in the shortcuts registry — plain
  menu item, mirrors commander's placement in spirit).

### Release pipeline (0.3.1 and onward)

1. Bump `package.json` version; build notarized universal DMG
   (`APPLE_KEYCHAIN_PROFILE=notarytool npm run dist:mac`).
2. `gh release create <ver>` + upload DMG (GitHub converts spaces in the asset
   name to dots — the appcast enclosure URL must use the *served* asset URL,
   read back via `gh release view --json assets`).
3. `/tmp/sparkle-bin/bin/sign_update <dmg>` (EdDSA key from login keychain —
   the shared key) → `sparkle:edSignature` + `length`.
4. Prepend `<item>` to `appcast.xml`; commit and push to main (the feed URL
   serves from main).

### Security notes

- The signature check pins the public key at build time; a compromised GitHub
  release alone cannot ship an installable update without the private key.
- `length` mismatch fails before signature verification (cheap first gate).
- Downloads land in the OS temp dir, are deleted on verification failure, and
  are never auto-executed — `shell.openPath` only mounts the DMG for the user.

## Testing

- Vitest: `parseAppcast` (full commander-shaped feed, malformed items, CDATA,
  missing enclosure), `compareVersions` / `pickUpdate` (newer/equal/older,
  multi-item ordering), `verifyEd25519` (round-trip with a freshly generated
  node:crypto keypair; tampered data/sig fail; bad base64 fails not throws).
- Registry: new command defaults asserted in shortcuts tests.
- Electron-coupled (find session wiring, dialogs, download): typecheck +
  scripted smoke — find on example.com via scripted input; updater against a
  local appcast + throwaway key via the env overrides.
