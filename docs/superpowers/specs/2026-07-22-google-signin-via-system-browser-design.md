# Google Sign-In via System Browser (Cookie Import) — Design

Date: 2026-07-22
Status: Implemented (0.11.1) — macOS + Chrome only

## Problem

Google's website sign-in ("This browser or app may not be secure. Learn more") rejects
Synapse. Confirmed root cause (investigation 2026-07-22/26):

- It is a **Google server-side change**, not a Synapse regression: rolling back to Synapse
  0.10.0 (which signed in fine before) reproduces the block identically.
- Two gates. Gate 1 (sign-in *page load*) checks `Sec-CH-UA` client-hint headers, which
  Electron 43 omits on navigations — spoofable. Gate 2 (identifier *submit*) runs a
  client-side BotGuard/`browserinfo` fingerprint that rejects Synapse even with perfect
  headers, `navigator.webdriver=false`, correct brands, and a populated `window.chrome`.
  Gate 2 is designed to resist spoofing; chasing it signal-by-signal is unwinnable.
- Real Chromium browsers pass Gate 2 because they are genuine builds; Electron differs at
  the JS-environment level.

**Goal:** let the user end up **logged into Google websites** (Gmail, Docs, YouTube) in
Synapse tabs — i.e. Synapse's session holds valid Google session cookies.

**Non-goal:** OAuth API tokens. RFC 8252 loopback OAuth authorizes an *app* and yields an
access/refresh token; it never produces website session cookies, so it cannot make
gmail.com show the user as logged in.

## Approach

Do the Google website sign-in in the **system Chrome** (which Google trusts), then **import
the resulting Google session cookies** into Synapse's Electron session so its tabs are
logged in.

```
Tools → "Sign in to Google…"
  → shell.openExternal(accounts.google.com sign-in URL)   [system browser]
  → user signs in there (passwords/2FA handled by the trusted browser)
  → native dialog: "click Import when done"
  → read + decrypt Chrome's Google cookies
  → session.cookies.set(...) into the active tab's profile session
  → reload the active tab; it is now logged in
```

The user never enters a password in Synapse; Google only ever authenticates its own browser.

## Feasibility (Phase 0, done 2026-07-26 = GO)

Extracted 64 Google cookies from Chrome's macOS store and injected into a Synapse dev
session → mail.google.com loaded fully logged in and stayed logged in across a hard reload.
Google's session cookies are **not** hard-bound against transplant. Injection gotchas found
and encoded in `toElectronCookie`: `SameSite=None` REQUIRES `secure=true` (Google auth
cookies are `is_secure=0` in Chrome's DB but HTTPS-only in practice); `__Host-` cookies must
be host-only (no domain) with path `/`.

## Implementation

- `src/shared/google-cookies.ts` — pure Chrome→Electron cookie mapping + Google-domain
  filter; Vitest-covered (`tests/google-cookies.test.ts`).
- `src/main/chrome-cookies.ts` — reads Chrome's `Default/Cookies` SQLite DB via built-in
  `node:sqlite` (Electron 43 bundles Node 24 — no runtime dependency) and decrypts v10
  AES-128-CBC values with the "Chrome Safe Storage" Keychain key (PBKDF2, salt `saltysalt`,
  1003 iters). Handles the Chrome v127+ 32-byte host-hash plaintext prefix. `expires_utc`
  exceeds `Number.MAX_SAFE_INTEGER`, so BigInt read mode is required.
- `src/main/google-signin.ts` — `runGoogleSignInFlow(win, tabs)`: opens sign-in, native
  dialog, imports into the active tab's profile session (`sessionForProfile`), reloads,
  reports. Menu-driven (no IPC; web tabs get no preload per REPO_RULES).
- Trigger: Tools menu item "Sign in to Google…".

Not used: `session.webRequest` (breaks web-tab creation + disables extension webRequest/dNR
— confirmed), BotGuard spoofing, custom-scheme/loopback server.

## Known limitations

- **macOS + Chrome only** (V1 scope). Other browsers/platforms are future work.
- **May break when Google rotates its cookie-binding scheme**; re-import fixes it. Inherent
  to the approach.
- First import triggers a one-time macOS Keychain access prompt (reading Chrome's Safe
  Storage key).
