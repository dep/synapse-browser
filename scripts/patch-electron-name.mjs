// Dev-only fix for the macOS menu bar / Dock / app switchers showing "Electron".
//
// In `npm run dev` the menu bar app title comes from CFBundleName in
// node_modules/electron/dist/Electron.app/Contents/Info.plist, and icon
// consumers that read from disk (Dock at registration, third-party Cmd-Tab
// switchers) use the bundle's electron.icns — productName, app.setName() and
// app.dock.setIcon() cannot reach them. Patch both and re-sign ad-hoc (an
// invalid signature won't launch on Apple Silicon). Runs on postinstall so an
// electron reinstall re-applies it. A packaged build gets name and icon from
// its own bundle and doesn't need this.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = 'Synapse Browser'

if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url)
  const appPath = join(dirname(require.resolve('electron')), 'dist', 'Electron.app')
  const plist = join(appPath, 'Contents', 'Info.plist')
  if (!existsSync(plist)) {
    console.log('patch-electron-name: Electron.app not found, skipping')
    process.exit(0)
  }
  const buddy = (cmd) =>
    execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, plist]).toString().trim()
  let changed = false

  if (buddy('Print :CFBundleName') !== NAME) {
    buddy(`Set :CFBundleName ${NAME}`)
    try {
      buddy(`Set :CFBundleDisplayName ${NAME}`)
    } catch {
      buddy(`Add :CFBundleDisplayName string ${NAME}`)
    }
    changed = true
  }

  const icnsSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'icon.icns')
  const icnsDst = join(appPath, 'Contents', 'Resources', 'electron.icns')
  if (existsSync(icnsSrc) && !readFileSync(icnsSrc).equals(readFileSync(icnsDst))) {
    copyFileSync(icnsSrc, icnsDst)
    changed = true
  }

  if (changed) {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath])
    // nudge LaunchServices to drop its cached name/icon for the bundle
    execFileSync('touch', [appPath])
    console.log(`patch-electron-name: dev Electron.app patched ("${NAME}" + icon)`)
  }
}
