import * as path from 'node:path'
import { searchSuggestions } from '../shared/history-search'
import type { HistoryEntry } from '../shared/ipc'
import { JsonStore } from './store'

const MAX_ENTRIES = 5000

interface HistoryFile {
  v: 1
  entries: HistoryEntry[]
}

export class HistoryStore {
  private store: JsonStore<HistoryFile>

  constructor(dir: string) {
    this.store = new JsonStore<HistoryFile>(path.join(dir, 'history.json'), { v: 1, entries: [] })
  }

  // deliberately dedupes only the immediate head: repeat visits keep their own
  // entries, and searchSuggestions counts them as the visit-frequency signal
  add(url: string, title: string, visitedAt: number): void {
    if (!/^https?:\/\//.test(url)) return
    const { entries } = this.store.get()
    if (entries[0]?.url === url) return
    const next = [{ url, title, visitedAt }, ...entries].slice(0, MAX_ENTRIES)
    this.store.set({ v: 1, entries: next })
  }

  search(query: string, limit = 5): HistoryEntry[] {
    return searchSuggestions(this.store.get().entries, [], query, limit)
  }

  entries(): HistoryEntry[] {
    return this.store.get().entries
  }

  list(limit = 100): HistoryEntry[] {
    return this.store.get().entries.slice(0, limit)
  }

  flush(): void {
    this.store.flush()
  }
}
