import { app, dialog, session } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore, loadAllExtensions, uninstallExtension } from 'electron-chrome-web-store'
import type { TabManager } from './tab-manager'

// how the extension layer finds "a window" now that there can be several:
// forTabWc maps a tab's webContents to the TabManager that owns it;
// target picks the window chrome.tabs.create and dialogs should land in
// (focused, falling back to primary)
export interface ExtensionWindowResolver {
  forTabWc(wc: WebContents): TabManager | null
  target(): { tabs: TabManager; win: BrowserWindow } | null
}

// Binds electron-chrome-extensions + the web-store install flow to the default
// session (the one all tabs use). Web-store extension files persist under
// <userData>/Extensions (managed by electron-chrome-web-store); unpacked
// extensions are copied into <userData>/UnpackedExtensions and reload at boot.
export class ExtensionManager {
  private extensions: ElectronChromeExtensions
  private webStorePath = join(app.getPath('userData'), 'Extensions')
  private unpackedPath = join(app.getPath('userData'), 'UnpackedExtensions')

  constructor(private resolve: ExtensionWindowResolver) {
    mkdirSync(this.unpackedPath, { recursive: true })
    this.extensions = new ElectronChromeExtensions({
      license: 'GPL-3.0',
      session: session.defaultSession,
      createTab: async (details) => {
        const t = this.resolve.target()
        if (!t) throw new Error('no window to open a tab in')
        const id = t.tabs.createTab(details.url, details.active ?? true)
        return [t.tabs.webContentsFor(id)!, t.win]
      },
      selectTab: (wc) => {
        // the library echoes our own selectTab notifications back here; re-activating
        // the already-active tab would commit an in-progress Ctrl+Tab cycle preview
        const tabs = this.resolve.forTabWc(wc)
        const id = tabs?.idFor(wc)
        if (tabs && id && id !== tabs.activeId) tabs.activateTab(id)
      },
      removeTab: (wc) => {
        const tabs = this.resolve.forTabWc(wc)
        const id = tabs?.idFor(wc)
        if (tabs && id) tabs.closeTab(id)
      },
    })
    // serves crx://extension-icon/... — without this the <browser-action-list>
    // element renders empty buttons
    ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
  }

  addTab(wc: WebContents, win: BrowserWindow): void {
    this.extensions.addTab(wc, win)
  }

  // a tab leaving its window (tear-out) unregisters here and re-registers
  // via addTab with the destination window
  removeTab(wc: WebContents): void {
    this.extensions.removeTab(wc)
  }

  selectTab(wc: WebContents): void {
    this.extensions.selectTab(wc)
  }

  // installs the chromewebstore.google.com "Add to Chrome" hook and loads
  // previously installed extensions from disk (web-store, then unpacked)
  async init(): Promise<void> {
    await installChromeWebStore({
      session: session.defaultSession,
      extensionsPath: this.webStorePath,
      minimumManifestVersion: 2, // default 3 would block MV2 installs like uBlock Origin classic
      beforeInstall: async (details) => {
        const { response } = await this.confirm({
          type: 'question',
          buttons: ['Cancel', 'Install'],
          defaultId: 1,
          cancelId: 0,
          message: `Add "${details.localizedName}" to Synapse?`,
        })
        return { action: response === 1 ? 'allow' : 'deny' }
      },
    })
    // per-extension failures are caught and logged by the library; boot never blocks
    await loadAllExtensions(session.defaultSession, this.unpackedPath, { allowUnpacked: true })
  }

  // confirmation dialog parented to the focused/primary window when one exists
  private confirm(opts: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
    const win = this.resolve.target()?.win
    return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)
  }

  // installed extensions, for the app menu's Extensions submenu
  list(): { id: string; name: string }[] {
    return session.defaultSession.extensions
      .getAllExtensions()
      .map((ext) => ({ id: ext.id, name: ext.name }))
  }

  // web-store installs uninstall via the library (removes from disk);
  // unpacked extensions unload from the session and their copy is deleted
  async remove(id: string): Promise<void> {
    const ext = session.defaultSession.extensions.getExtension(id)
    if (!ext) return
    const { response } = await this.confirm({
      type: 'warning',
      buttons: ['Cancel', 'Remove'],
      defaultId: 1,
      cancelId: 0,
      message: `Remove "${ext.name}"?`,
    })
    if (response !== 1) return
    if (ext.path.startsWith(this.unpackedPath)) {
      session.defaultSession.extensions.removeExtension(id)
      rmSync(ext.path, { recursive: true, force: true })
    } else {
      await uninstallExtension(id, {
        session: session.defaultSession,
        extensionsPath: this.webStorePath,
      })
    }
  }

  // copies the picked folder into UnpackedExtensions so it reloads at boot
  async loadUnpacked(): Promise<void> {
    const win = this.resolve.target()?.win
    const dialogOpts = {
      title: 'Load Unpacked Extension',
      properties: ['openDirectory' as const],
    }
    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts)
    if (canceled || !filePaths[0]) return
    const src = filePaths[0]
    const alreadyInside = src.startsWith(this.unpackedPath)
    const dest = alreadyInside ? src : join(this.unpackedPath, basename(src))
    try {
      if (!alreadyInside) cpSync(src, dest, { recursive: true })
      // no explicit worker start: Chromium self-starts a freshly registered MV3
      // worker, and startWorkerForScope before registration completes rejects
      // with "Failed to start service worker"
      await session.defaultSession.extensions.loadExtension(dest)
    } catch (err) {
      if (!alreadyInside) rmSync(dest, { recursive: true, force: true })
      dialog.showErrorBox('Failed to load extension', err instanceof Error ? err.message : String(err))
    }
  }
}
