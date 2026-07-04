import * as path from 'node:path'
import { searchHistory } from '../shared/history-search'
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

  add(url: string, title: string, visitedAt: number): void {
    if (!/^https?:\/\//.test(url)) return
    const { entries } = this.store.get()
    if (entries[0]?.url === url) return
    const next = [{ url, title, visitedAt }, ...entries].slice(0, MAX_ENTRIES)
    this.store.set({ v: 1, entries: next })
  }

  search(query: string, limit = 5): HistoryEntry[] {
    return searchHistory(this.store.get().entries, query, limit)
  }

  list(limit = 100): HistoryEntry[] {
    return this.store.get().entries.slice(0, limit)
  }

  flush(): void {
    this.store.flush()
  }
}
