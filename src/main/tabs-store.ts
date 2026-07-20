import * as path from 'node:path'
import type { ProfileId } from '../shared/ipc'
import { JsonStore } from './store'

export interface TabEntry {
  url: string
  profile: ProfileId
  title?: string // user-set name (double-click rename); absent = page title
  group?: string // tab-group ref into the saved groups list; absent = ungrouped
}

// saved tab-group meta; ids are only stable within one file — restore mints
// fresh runtime ids and remaps membership
export interface TabGroupEntry {
  id: string
  name: string
  profile?: ProfileId
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

interface TabsFileV4 {
  v: 4
  tabs: TabEntry[]
  groups: TabGroupEntry[]
  active: number
}

type TabsFile = TabsFileV1 | TabsFileV2 | TabsFileV4

// only real web pages restore to their url; blank tabs and transient pages
// (error data: urls, about:) come back as empty new tabs
const PERSISTABLE = /^https?:\/\//

export class TabsStore {
  private store: JsonStore<TabsFile>

  constructor(dir: string) {
    this.store = new JsonStore<TabsFile>(path.join(dir, 'tabs.json'), {
      v: 4,
      tabs: [],
      groups: [],
      active: -1,
    })
  }

  save(tabs: TabEntry[], active: number, groups: TabGroupEntry[] = []): void {
    this.store.set({
      v: 4,
      tabs: tabs.map((t) => ({
        url: PERSISTABLE.test(t.url) ? t.url : '',
        profile: t.profile,
        ...(t.title ? { title: t.title } : {}),
        ...(t.group ? { group: t.group } : {}),
      })),
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        ...(g.profile && g.profile !== 'default' ? { profile: g.profile } : {}),
      })),
      active,
    })
  }

  load(): { tabs: TabEntry[]; active: number; groups: TabGroupEntry[] } {
    const data = this.store.get()
    // v1 files carried a plain urls array; they load as default-profile tabs
    const raw: unknown[] =
      'tabs' in data && Array.isArray(data.tabs)
        ? data.tabs
        : 'urls' in data && Array.isArray(data.urls)
          ? data.urls.map((url) => ({ url, profile: 'default' }))
          : []
    const rawGroups: unknown[] = 'groups' in data && Array.isArray(data.groups) ? data.groups : []
    const groups = rawGroups.flatMap((g): TabGroupEntry[] => {
      if (typeof g !== 'object' || g === null) return []
      const { id, name, profile } = g as { id?: unknown; name?: unknown; profile?: unknown }
      if (typeof id !== 'string' || typeof name !== 'string') return []
      return [{ id, name, ...(profile === 'work' ? { profile: 'work' as const } : {}) }]
    })
    const knownGroups = new Set(groups.map((g) => g.id))
    const clean = raw.flatMap((t): TabEntry[] => {
      if (typeof t !== 'object' || t === null) return []
      const { url, profile, title, group } = t as {
        url?: unknown
        profile?: unknown
        title?: unknown
        group?: unknown
      }
      if (typeof url !== 'string') return []
      return [
        {
          url,
          profile: profile === 'work' ? 'work' : 'default',
          ...(typeof title === 'string' && title ? { title } : {}),
          ...(typeof group === 'string' && knownGroups.has(group) ? { group } : {}),
        },
      ]
    })
    const idx = Number.isInteger(data.active) ? data.active : 0
    return { tabs: clean, active: Math.min(Math.max(idx, 0), clean.length - 1), groups }
  }

  flush(): void {
    this.store.flush()
  }
}
