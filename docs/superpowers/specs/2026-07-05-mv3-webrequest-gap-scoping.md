# MV3 webRequest Gap — Root Cause & Options

**Date:** 2026-07-05
**Status:** Scoping (decision pending)
**Upstream:** [electron#52265](https://github.com/electron/electron/issues/52265) (filed from this repo, root cause posted)

## What we found

The "NordPass gap" is two independent problems stacked on top of each other.

### Layer 1 — Electron 43 packaging regression (crashes everything, fixed on main)

Chromium 149→150 moved the extensions renderer bindings JS into a new
`extensions_renderer_generated_resources.pak`; Electron 43's `build/electron_paks.gni`
never repacks it. Result: `chrome.webRequest` is schema-registered but memberless in
**every** extension context — MV2 background pages fail identically to MV3 workers
(`NOTREACHED` in `resource_bundle_source_map.cc`, `onBeforeRequest` undefined). A worker
that touches it throws, which fails MV3 service-worker registration ("Status code: 15").

- Fixed on Electron `main` by [electron#51804](https://github.com/electron/electron/pull/51804)
  (2026-06-01, incidental to resource-allowlist work). **Not** on `43-x-y` or `44-x-y`;
  backport requested in #52265.
- Verified on `electron-nightly` 45.0.0-nightly.20260703: bindings load, MV2
  background-page `onBeforeRequest` fires.
- Implication for Synapse today: MV2 uBlock Origin's *network-level* blocking has
  likely never worked on Electron 43 — its startup `webRequest` calls hit the same
  broken API. The passing "ads blocked" smoke item was probably cosmetic filtering via
  content scripts. Re-run the smoke test after upgrading past the fix.

### Layer 2 — MV3 service-worker event dispatch is unwired even on main

On the same nightly, an MV3 worker registers `onBeforeRequest` without error but
receives **zero events** (MV2 fires; `<all_urls>` in both `permissions` and
`host_permissions` tried). The browser→SW webRequest dispatch path (lazy/SW listeners
in the WebRequest event router) is missing independently of Layer 1. This is what
actually blocks NordPass-class extensions, and no scheduled Electron release fixes it.

### Adjacent facts (verified empirically on stock 43.0.0)

- `chrome.declarativeNetRequest` **dynamic/session rules work and enforce** when the
  `declarativeNetRequest` permission is declared. Static `rule_resources` never load
  (`getEnabledRulesets()` → `[]`) — Electron's extension loader skips install-time
  ruleset indexing. Matters for uBO Lite.
- **Exclusivity:** one `session.webRequest` listener (or `protocol.intercept*`)
  disables ALL extension webRequest events and ALL dNR enforcement for those loader
  factories. Synapse must never use `session.webRequest` on the extensions session
  (rule added to `.agents/REPO_RULES.md`).
- `electron-chrome-extensions` 4.9.0 (latest) has **no** main-process webRequest
  backend; its preload declares a dead `webRequest.onHeadersReceived` stub. But its
  router already solves the hard parts: IPC into MV3 workers (`serviceWorker.ipc`) and
  waking sleeping workers before event delivery (`startWorkerForScope`).

## Options

| # | Path | Fixes | Cost | Risk |
|---|------|-------|------|------|
| 1 | Track #52265 backport / upgrade Electron past #51804 | Layer 1 (MV2 webRequest, no more worker crashes) | ~0 (version bump) | Timing of upstream release; 44-x-y also lacks fix |
| 2 | Userland: add webRequest backend to `electron-chrome-extensions` (new `src/browser/api/web-request.ts` mirroring `web-navigation.ts`, ~250 LoC main + ~80 LoC preload), upstream PR | Layer 2 for observational events — the NordPass case | 2–4 days | Fidelity gaps (no `onAuthRequired`, approximate URL matching); upstream merge timing (no competing work) |
| 3 | C++: wire SW event dispatch in Electron's WebRequest router | Layer 2 natively | Weeks; full Chromium checkout/build; unscoped | High; needs upstream buy-in |
| 4 | C++: static dNR ruleset indexing in `electron_extension_loader.cc` | uBO-Lite-style static rules | ~50–150 LoC but needs source build | Medium (install-flow semantics) |

MV3 blocking webRequest is not a gap: Chrome itself restricts `webRequestBlocking` to
MV2/policy installs. After Layers 1+2, Electron matches real Chrome: MV3 gets
observational webRequest + dNR for blocking.

## Recommendation

Do **1 + 2**: take the free Layer-1 fix when it ships (watch #52265; check 44-x-y
before any Electron upgrade), and build the userland webRequest backend as an
upstreamable `electron-chrome-extensions` PR for Layer 2 — it's days not weeks, needs
no C++, and the wake/routing machinery already exists in the library. Before starting,
smoke-test whether NordPass needs only observational webRequest (if it also requires
static dNR, Layer 4 joins the critical path).

Repro + test artifacts: gist
[ec59df6](https://gist.github.com/dep/ec59df61562cfb3af21031a660e733b4); scratchpad
`webrequest-repro/`, `mv2fire/`, `mv3fire/`, `dnrtest/` (session-local).
