import * as path from 'node:path'
import { JsonStore } from './store'

interface TabsFile {
  v: 1
  urls: string[]
  active: number
}

// only real web pages restore to their url; blank tabs and transient pages
// (error data: urls, about:) come back as empty new tabs
const PERSISTABLE = /^https?:\/\//

export class TabsStore {
  private store: JsonStore<TabsFile>

  constructor(dir: string) {
    this.store = new JsonStore<TabsFile>(path.join(dir, 'tabs.json'), { v: 1, urls: [], active: -1 })
  }

  save(urls: string[], active: number): void {
    this.store.set({ v: 1, urls: urls.map((u) => (PERSISTABLE.test(u) ? u : '')), active })
  }

  load(): { urls: string[]; active: number } {
    const { urls, active } = this.store.get()
    const clean = (Array.isArray(urls) ? urls : []).filter((u): u is string => typeof u === 'string')
    const idx = Number.isInteger(active) ? active : 0
    return { urls: clean, active: Math.min(Math.max(idx, 0), clean.length - 1) }
  }

  flush(): void {
    this.store.flush()
  }
}
