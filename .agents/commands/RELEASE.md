<!-- Project-specific. electron-builder based release flow for Synapse Browser. -->

# Release (Synapse Browser)

## Description

Version, build, sign, notarize, DMG, and publish a new release of Synapse Browser to
GitHub Releases. No auto-update wiring — users download and re-install the DMG for
updates.

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
export CSC_NAME="Developer ID Application: Danny Peck (299R8V27FZ)"
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

Nothing extra needed — no appcast, no separate update feed. Just confirm:

1. `resources/icon.icns` exists (it does) — used as the DMG/app icon.
2. `electron-builder.yml`'s `publish.owner`/`publish.repo` match the GitHub repo
   (`dep/synapse-browser`).
