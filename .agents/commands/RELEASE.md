<!-- Project-specific. electron-builder based release flow for Synapse Browser. -->

# Release (Synapse Browser)

## Description

Version, build, sign, notarize, DMG, and publish a new release of Synapse Browser to
GitHub Releases. Users download and re-install the DMG for updates.

electron-builder does the sign + notarize + DMG steps in one call (`electron-builder.yml`),
unlike the raw xcodebuild flow used for the native Swift app — there's no separate
export/entitlements-repair step.

## Prerequisites

- Developer ID Application certificate in login keychain:
  `Developer ID Application: Danny Peck (299R8V27FZ)`
- `notarytool` keychain profile named `notarytool` (see Setup)
- `gh` CLI authenticated

## Setup: Store Notarization Credentials (one-time)

```bash
source .env && xcrun notarytool store-credentials "notarytool" \
  --apple-id "$APPLE_EMAIL" \
  --team-id "299R8V27FZ" \
  --password "$APPLE_APP_PASSWORD"
```

`electron-builder.yml` has `mac.notarize: true`, which activates `@electron/notarize`.
It reads credentials from env vars at build time — pass `APPLE_KEYCHAIN_PROFILE` to use
the `notarytool` keychain profile (see step 2).

## Step-by-Step

### 0. Bump the version

Edit `package.json`:

```json
"version": "x.y.z"
```

### 1. Build the renderer/main bundles

```bash
npm run typecheck && npm test && npm run build
```

### 2. Build, sign, notarize, and DMG in one step

```bash
# CSC_NAME must NOT include the "Developer ID Application:" prefix —
# electron-builder errors out and picks the certificate type automatically
export CSC_NAME="Danny Peck (299R8V27FZ)"
export APPLE_KEYCHAIN_PROFILE="notarytool"
npm run dist:mac
```

This runs `electron-builder --mac --publish never`, which:
- packages `out/` into `Synapse Browser.app`
- code-signs with hardened runtime + `build/entitlements.mac.plist`
- notarizes via the `notarytool` keychain profile and staples the ticket
- produces a universal DMG in `dist/`

Expect `dist/Synapse Browser-<version>-universal.dmg`.

### 3. Verify

```bash
APP="dist/mac-universal/Synapse Browser.app"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute --verbose "$APP"
xcrun stapler validate "$APP"
```

Should show `accepted / source=Notarized Developer ID` and `The validate action worked!`.
Note: electron-builder staples the ticket to the `.app` before packaging, not to the
DMG container — validating the DMG file itself will report "does not have a ticket
stapled to it", which is expected and harmless (the app inside is what Gatekeeper checks).

### 4. Commit the version bump

```bash
git add package.json package-lock.json && \
git commit -m "chore: bump version to <version>" && \
git push
```

### 5. Create the GitHub release and upload the DMG

```bash
gh release create <version> \
  --title "<version>" \
  --notes "<release notes>" \
  "dist/Synapse Browser-<version>-universal.dmg"
```

### 6. Publish the sparkle appcast

The app checks `https://raw.githubusercontent.com/dep/synapse-browser/main/appcast.xml`
for signed updates (see `docs/superpowers/specs/2026-07-08-find-and-sparkle-design.md`).

```bash
# served asset URL (GitHub converts spaces to dots — use this, not the local name)
gh release view <version> --json assets --jq '.assets[].url'
# EdDSA signature + length (shared key from the login keychain)
/tmp/sparkle-bin/bin/sign_update "dist/Synapse Browser-<version>-universal.dmg"
```

Prepend a new `<item>` to `appcast.xml` (copy the previous item's shape: title,
RFC-2822 `pubDate`, `sparkle:version`, CDATA release notes, enclosure with the
served URL + `sparkle:edSignature` + `length`). Do NOT hand-transcribe the
signature — script the substitution from `sign_update` output. Sanity-check
before pushing (parser picks the new version, signature verifies against the
pinned key):

```bash
node --experimental-strip-types -e "
import { readFileSync } from 'node:fs'
import { verifyEd25519 } from './src/main/ed25519.ts'
import { parseAppcast, pickUpdate } from './src/shared/appcast.ts'
const upd = pickUpdate(parseAppcast(readFileSync('appcast.xml','utf8')), '<previous-version>')
const dmg = readFileSync('dist/Synapse Browser-<version>-universal.dmg')
console.log(upd?.version, dmg.length === Number(upd.length),
  verifyEd25519(dmg, upd.edSignature, 'Tnoq0NNryfeGcjS0eQ2xfuOuvqf4dRoa3wF86ljVZh4='))
"
```

Then `git add appcast.xml && git commit -m "chore: publish sparkle appcast for <version>" && git push`
(the feed serves from main).

## Expected Output

- electron-builder logs: `notarization successful`
- `spctl`: `accepted / source=Notarized Developer ID`
- `codesign --verify --deep`: silent, then `valid on disk` / `satisfies its Designated Requirement`
- `xcrun stapler validate` on the `.app`: `The validate action worked!`

## Artifacts

- Notarized app: `dist/mac-universal/Synapse Browser.app`
- DMG: `dist/Synapse Browser-<version>-universal.dmg`
- GitHub release with DMG attached

## First-Release Checklist

Confirm:

1. `resources/icon.icns` exists (it does) — used as the DMG/app icon.
2. `electron-builder.yml`'s `publish.owner`/`publish.repo` match the GitHub repo
   (`dep/synapse-browser`).
