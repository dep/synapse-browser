# Tab Profiles (Default + Work) — Design

Date: 2026-07-06
Status: Approved

## Goal

Let a tab be assigned to a session container ("profile") via the tab context menu, so
two instances of the same site (e.g. Gmail) can run logged into different accounts in
the same window. V1 ships a fixed pair: **Default** and **Work**.

## Mechanism

Electron session partitions. Default tabs keep `session.defaultSession` exactly as
today (zero behavior change). Work tabs are created with
`webPreferences.partition: 'persist:profile-work'` — a persistent session with its own
cookies, storage, and cache, so Work logins survive restart.

A `WebContents`' session is fixed at creation, so **switching a tab's profile
recreates its `WebContentsView`** in the new partition and reloads the current URL —
the same destroy/recreate lifecycle sleeping pins already use. The tab keeps its id
and its sidebar/MRU position (`tab-model.ts` is untouched). Back/forward history
resets on switch; the page starts logged-out in the new container (that is the point).

## Profile model

```ts
type ProfileId = 'default' | 'work'
```

- Stored per tab in `TabManager` (not in `TabModel` — profiles don't affect
  ordering/MRU/cycling).
- New tabs are always `default`. A tab opts into Work explicitly via context menu.
- `TabInfo` (in `src/shared/ipc.ts`) gains `profile: ProfileId` so the renderer can
  render an indicator.

## Changes by file

### `src/main/tab-manager.ts`

- `createTab(url?, activate?, profile?)` and `createView(id, profile)`; non-default
  profile passes `partition` in `webPreferences`.
- `setProfile(id, profile)`: no-op if unchanged; otherwise capture current URL,
  destroy the view (reusing the `destroyView` path), create a replacement view in the
  new partition, reload the URL, re-sync. Handles the attached/focused case the same
  way `sleepPin`/`wakePin` do.
- Popup inheritance: the `setWindowOpenHandler` in `createView` opens popups via
  `createTab(popupUrl, true, parentProfile)` — OAuth popups from a Work tab must land
  in the Work container.
- `PinSlot` gains `profile` (default `'default'`); `wakePin` recreates the view in the
  slot's partition.
- Snapshot includes `profile` per tab.

### `src/main/index.ts`

- Create the Work session once at startup: `session.fromPartition('persist:profile-work')`.
- Attach `DownloadManager` to the Work session as well as the default one.
- Tab context menu gains a `Profile` submenu with radio items Default / Work →
  `tabs.setProfile(id, …)`.
- `onTabCreated` skips `extensions.addTab(wc)` for Work tabs (see Extensions).
- `attachCycleHooks` still applies to all tabs (per-WebContents, session-agnostic).

### Extensions (`src/main/extensions.ts` — guard only)

Work tabs get **no extensions** in v1: nothing is loaded into the Work session, so no
content scripts, no webRequest, no browser actions there. Work tabs are also **not
registered** with `ElectronChromeExtensions` (`addTab`/`selectTab` skipped) —
registering them would expose Work tab URLs to default-session extensions through
`chrome.tabs`, quietly breaking the container boundary. Implementation must verify
`selectTab` on an unregistered tab is a safe no-op (guard in `ExtensionManager` if the
library throws).

Per repo rules: no `session.webRequest` or `protocol.intercept*` handlers on any
session — the Work session stays clean too.

### Persistence

- `tabs-store.ts`: schema bumps to `v: 2`, saving `{ url, profile }` per tab. Loader
  stays tolerant of the v1 string-array format (old entries load as `default`).
- `pins-store.ts`: `PinSlot.profile` persisted; missing field loads as `default`.

### Renderer (chrome UI)

Sidebar tab rows render a small colored dot for `profile === 'work'` (title
attribute "Work profile"). Renderer remains a pure function of `tabs:updated`
snapshots; no new state.

## Error handling

- `setProfile` on a blank/error tab (no `https?` URL): recreate the view empty in the
  new partition and focus the URL bar, mirroring `createTab()` with no URL.
- Sleeping pins: `setProfile` on an asleep pin just updates the slot's `profile`; the
  view is created in the right partition on wake.

## Testing

- Vitest: tabs-store v1→v2 load tolerance and v2 round-trip; pins-store profile
  round-trip.
- `tab-model.ts` untouched — existing tests stand.
- Manual smoke: assign a Gmail tab to Work, log into a second account, verify both
  stay logged in across a restart; verify a Work OAuth popup opens in Work; verify
  extensions (NordPass/uBlock) act on Default tabs only; verify downloads work from a
  Work tab.

## Out of scope (deliberate)

- User-defined profiles / management UI.
- Extensions in the Work session.
- Per-profile new-tab shortcuts or window-level profile defaults.
