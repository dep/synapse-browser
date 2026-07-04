import { app, shell } from 'electron'
import type { Session } from 'electron'
import * as path from 'node:path'
import type { DownloadInfo } from '../shared/ipc'
import { uniquePath } from './unique-path'

export class DownloadManager {
  private list: DownloadInfo[] = []
  private paths = new Map<string, string>()
  private counter = 0

  constructor(private onUpdate: (list: DownloadInfo[]) => void) {}

  attach(session: Session): void {
    session.on('will-download', (_e, item) => {
      const id = `dl-${++this.counter}`
      const savePath = uniquePath(app.getPath('downloads'), item.getFilename())
      item.setSavePath(savePath)
      this.paths.set(id, savePath)
      const info: DownloadInfo = {
        id,
        filename: path.basename(savePath),
        state: 'progressing',
        receivedBytes: 0,
        totalBytes: item.getTotalBytes(),
      }
      this.list.push(info)
      this.emit()
      item.on('updated', () => {
        info.receivedBytes = item.getReceivedBytes()
        this.emit()
      })
      item.once('done', (_ev, state) => {
        info.state = state === 'completed' ? 'completed' : 'failed'
        info.receivedBytes = item.getReceivedBytes()
        this.emit()
      })
    })
  }

  reveal(id: string): void {
    const p = this.paths.get(id)
    const info = this.list.find((d) => d.id === id)
    if (p && info?.state === 'completed') shell.showItemInFolder(p)
  }

  private emit(): void {
    this.onUpdate([...this.list])
  }
}
