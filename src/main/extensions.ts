import { app, dialog, session } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { join } from 'node:path'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore } from 'electron-chrome-web-store'
import type { TabManager } from './tab-manager'

// Binds electron-chrome-extensions + the web-store install flow to the default
// session (the one all tabs use). Extension files persist under
// <userData>/Extensions, managed entirely by electron-chrome-web-store.
export class ExtensionManager {
  private extensions: ElectronChromeExtensions

  constructor(
    private win: BrowserWindow,
    tabs: TabManager,
  ) {
    this.extensions = new ElectronChromeExtensions({
      license: 'GPL-3.0',
      session: session.defaultSession,
      createTab: async (details) => {
        const id = tabs.createTab(details.url, details.active ?? true)
        return [tabs.webContentsFor(id)!, this.win]
      },
      selectTab: (wc) => {
        // the library echoes our own selectTab notifications back here; re-activating
        // the already-active tab would commit an in-progress Ctrl+Tab cycle preview
        const id = tabs.idFor(wc)
        if (id && id !== tabs.activeId) tabs.activateTab(id)
      },
      removeTab: (wc) => {
        const id = tabs.idFor(wc)
        if (id) tabs.closeTab(id)
      },
    })
    // serves crx://extension-icon/... — without this the <browser-action-list>
    // element renders empty buttons
    ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
  }

  addTab(wc: WebContents): void {
    this.extensions.addTab(wc, this.win)
  }

  selectTab(wc: WebContents): void {
    this.extensions.selectTab(wc)
  }

  // installs the chromewebstore.google.com "Add to Chrome" hook and loads
  // previously installed extensions from disk
  async init(): Promise<void> {
    await installChromeWebStore({
      session: session.defaultSession,
      extensionsPath: join(app.getPath('userData'), 'Extensions'),
      minimumManifestVersion: 2, // default 3 would block MV2 installs like uBlock Origin classic
      beforeInstall: async (details) => {
        const { response } = await dialog.showMessageBox(this.win, {
          type: 'question',
          buttons: ['Cancel', 'Install'],
          defaultId: 1,
          cancelId: 0,
          message: `Add "${details.localizedName}" to Synapse?`,
        })
        return { action: response === 1 ? 'allow' : 'deny' }
      },
    })
  }

  // dev escape hatch; loaded for this run only, not persisted
  async loadUnpacked(): Promise<void> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.win, {
      title: 'Load Unpacked Extension',
      properties: ['openDirectory'],
    })
    if (canceled || !filePaths[0]) return
    try {
      const ext = await session.defaultSession.extensions.loadExtension(filePaths[0])
      // web-store loads start MV3 workers themselves; unpacked loads must do it here
      const manifest = ext.manifest as {
        manifest_version?: number
        background?: { service_worker?: string }
      }
      if (manifest.manifest_version === 3 && manifest.background?.service_worker) {
        await session.defaultSession.serviceWorkers.startWorkerForScope(ext.url)
      }
    } catch (err) {
      dialog.showErrorBox('Failed to load extension', err instanceof Error ? err.message : String(err))
    }
  }
}
