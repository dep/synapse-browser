import * as path from 'node:path'
import type { ProfileId } from '../shared/ipc'
import { JsonStore } from './store'

export interface TabEntry {
  url: string
  profile: ProfileId
  title?: string // user-set name (double-click rename); absent = page title
}

interface TabsFileV1 {
  v: 1
  urls: string[]
  active: number
}

interface TabsFileV2 {
  v: 2 | 3
  tabs: TabEntry[]
  active: number
}

type TabsFile = TabsFileV1 | TabsFileV2

// only real web pages restore to their url; blank tabs and transient pages
// (error data: urls, about:) come back as empty new tabs
const PERSISTABLE = /^https?:\/\//

export class TabsStore {
  private store: JsonStore<TabsFile>

  constructor(dir: string) {
    this.store = new JsonStore<TabsFile>(path.join(dir, 'tabs.json'), { v: 3, tabs: [], active: -1 })
  }

  save(tabs: TabEntry[], active: number): void {
    this.store.set({
      v: 3,
      tabs: tabs.map((t) => ({
        url: PERSISTABLE.test(t.url) ? t.url : '',
        profile: t.profile,
        ...(t.title ? { title: t.title } : {}),
      })),
      active,
    })
  }

  load(): { tabs: TabEntry[]; active: number } {
    const data = this.store.get()
    // v1 files carried a plain urls array; they load as default-profile tabs
    const raw: unknown[] =
      'tabs' in data && Array.isArray(data.tabs)
        ? data.tabs
        : 'urls' in data && Array.isArray(data.urls)
          ? data.urls.map((url) => ({ url, profile: 'default' }))
          : []
    const clean = raw.flatMap((t): TabEntry[] => {
      if (typeof t !== 'object' || t === null) return []
      const { url, profile, title } = t as { url?: unknown; profile?: unknown; title?: unknown }
      if (typeof url !== 'string') return []
      return [
        {
          url,
          profile: profile === 'work' ? 'work' : 'default',
          ...(typeof title === 'string' && title ? { title } : {}),
        },
      ]
    })
    const idx = Number.isInteger(data.active) ? data.active : 0
    return { tabs: clean, active: Math.min(Math.max(idx, 0), clean.length - 1) }
  }

  flush(): void {
    this.store.flush()
  }
}
