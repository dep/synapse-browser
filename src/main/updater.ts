import { app, dialog, net, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAppcast, pickUpdate } from '../shared/appcast'
import type { AppcastItem } from '../shared/appcast'
import { APPCAST_URL, SU_PUBLIC_KEY } from '../shared/update-config'
import { verifyEd25519 } from './ed25519'

// speaks Sparkle's protocol (appcast + EdDSA-signed enclosures) without the
// native framework: fetch feed → compare versions → download → verify with
// the pinned public key → open the DMG for a guided install. Never
// self-replaces the app bundle and never executes what it downloads.
export class Updater {
  private busy = false

  constructor(private win: BrowserWindow) {}

  async check(interactive: boolean): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await this.run(interactive)
    } catch (err) {
      console.error('updater: check failed', err)
      if (interactive) {
        void dialog.showMessageBox(this.win, {
          type: 'error',
          message: 'Could not check for updates.',
          detail: String(err),
        })
      }
    } finally {
      this.busy = false
    }
  }

  private async run(interactive: boolean): Promise<void> {
    const feedUrl = process.env['SYNAPSE_APPCAST_URL'] || APPCAST_URL
    const res = await net.fetch(feedUrl, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`appcast HTTP ${res.status}`)
    const item = pickUpdate(parseAppcast(await res.text()), app.getVersion())
    if (!item) {
      if (interactive) {
        void dialog.showMessageBox(this.win, {
          type: 'info',
          message: "You're up to date.",
          detail: `Synapse Browser ${app.getVersion()} is the latest version.`,
        })
      }
      return
    }
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'info',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Synapse Browser ${item.shortVersion} is available.`,
      detail: stripHtml(item.notesHtml ?? '') || 'A new version is available.',
    })
    if (response !== 0) return
    // from here on the user asked for it — failures always surface
    try {
      await this.download(item)
    } catch (err) {
      console.error('updater: download failed', err)
      void dialog.showMessageBox(this.win, {
        type: 'error',
        message: 'Update could not be verified.',
        detail: `${String(err)}\n\nNothing was installed.`,
      })
    }
  }

  private async download(item: AppcastItem): Promise<void> {
    const res = await net.fetch(item.url, { signal: AbortSignal.timeout(300_000) })
    if (!res.ok) throw new Error(`download HTTP ${res.status}`)
    const data = Buffer.from(await res.arrayBuffer())
    if (item.length > 0 && data.byteLength !== item.length) {
      throw new Error(`size mismatch: got ${data.byteLength} bytes, appcast says ${item.length}`)
    }
    const publicKey = process.env['SYNAPSE_SU_PUBLIC_KEY'] || SU_PUBLIC_KEY
    if (!verifyEd25519(data, item.edSignature, publicKey)) {
      throw new Error('EdDSA signature did not verify')
    }
    const file = join(app.getPath('temp'), `SynapseBrowser-${item.shortVersion}.dmg`)
    writeFileSync(file, data)
    await shell.openPath(file)
    void dialog.showMessageBox(this.win, {
      type: 'info',
      message: 'Update downloaded and verified.',
      detail:
        'Quit Synapse Browser, drag the new version into Applications, then relaunch.',
    })
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
