---
name: verify
description: Launch and drive a dev instance of Synapse Browser for runtime verification, alongside the user's installed copy
---

# Verifying Synapse Browser at runtime

## Launch a dev instance alongside the installed app

The installed app holds the single-instance lock (same userData path).
`SYNAPSE_USER_DATA` relocates userData — and therefore the lock — so a dev
instance can run in parallel:

```bash
SYNAPSE_USER_DATA=/tmp/synapse-verify/profile npm run dev -- -- --remote-debugging-port=9223
```

- Port 9222 is usually taken by Chrome on this machine; use 9223.
- Wait for CDP: poll `http://127.0.0.1:9223/json/list` (~10s to first response).
- If the app exits immediately with code 0 and no error, it lost the
  single-instance lock — the env var is missing or another dev instance runs.

## Drive tabs over CDP

Node 24's built-in `WebSocket` is enough — no npm deps. Targets from
`/json/list`: the chrome UI is the `localhost:5173` page; web tabs are the
others.

**Gotcha:** `Runtime.evaluate` hangs forever on a fresh empty tab (no document,
so no execution context). `Page.navigate` first, then evaluate.

**Gotcha:** `document.visibilityState` tracks window occlusion, not view
attachment — every target reports `hidden` when the dev window is covered.
To check whether a tab's WebContentsView is attached, read
`innerWidth`/`innerHeight` in the page target: a never-attached view keeps its
default 0×0 bounds; an attached one gets the canvas size from main's layout().

The chrome UI target exposes `window.synapse` (SynapseApi) — `tabs.create(url)`
etc. Work-profile tab creation is native-menu only, not reachable over CDP.

## Simulated input over CDP

`Input.dispatchMouseEvent` / `dispatchKeyEvent` on a page target work, BUT:

- **An occluded window silently drops mouse events** — macOS backgrounding
  marks the widgets hidden and dispatch becomes a no-op (calls still return
  success). Launch with `--disable-backgrounding-occluded-windows
  --disable-renderer-backgrounding` appended after `--remote-debugging-port`,
  and `Page.bringToFront` the target before clicking.
- **The user's real keystrokes land in the dev window** whenever it has OS
  focus. Any feature reading modifier state (alt-click → split, tab cycling)
  can be armed/disarmed by the human typing mid-test — a flaky run may be
  contamination, not a bug. Re-run before digging.
- `input-event` on a WebContents delivers mouse type/button but NO modifiers;
  `before-input-event` is keyboard-only. Alt-click on a link surfaces in main
  as a session `will-download` (Chromium "save link" semantics), not as a
  window-open or navigation.

## Observing network behavior

For header-level evidence (UA, client hints), run a local echo server and
navigate a tab to it — captures exactly what real sites receive:

```js
http.createServer((req, res) => {
  fs.appendFileSync(log, `${req.url} UA: ${req.headers['user-agent']}\n`)
  res.end('ok')
}).listen(8931)
```

## Cleanup

Stop the background dev task, then `pkill -f "remote-debugging-port=9223"` —
electron-vite's child Electron can outlive the npm process.
