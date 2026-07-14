import * as path from 'node:path'
import { JsonStore } from './store'

const MAX_HOSTS = 2000

interface FaviconsFile {
  v: 1
  hosts: Record<string, string>
}

// host → favicon URL, insertion-ordered so the cap drops the least recently
// updated hosts. Suggestion rows join on this at search time.
export class FaviconStore {
  private store: JsonStore<FaviconsFile>

  constructor(dir: string) {
    this.store = new JsonStore<FaviconsFile>(path.join(dir, 'favicons.json'), {
      v: 1,
      hosts: {},
    })
  }

  set(pageUrl: string, favicon: string | null): void {
    if (!favicon || !/^https?:\/\//.test(pageUrl)) return
    const host = hostOf(pageUrl)
    if (!host) return
    const next = { ...this.store.get().hosts }
    delete next[host] // re-insert at the end = newest cap position
    next[host] = favicon
    const keys = Object.keys(next)
    for (let i = 0; i < keys.length - MAX_HOSTS; i++) delete next[keys[i]]
    this.store.set({ v: 1, hosts: next })
  }

  get(url: string): string | null {
    const host = hostOf(url)
    return host ? (this.store.get().hosts[host] ?? null) : null
  }

  flush(): void {
    this.store.flush()
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}
