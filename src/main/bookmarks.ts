import * as path from 'node:path'
import type { Bookmark } from '../shared/ipc'
import { JsonStore } from './store'

interface BookmarksFile {
  v: 1
  bookmarks: Bookmark[]
}

export class BookmarksStore {
  private store: JsonStore<BookmarksFile>

  constructor(dir: string) {
    this.store = new JsonStore<BookmarksFile>(path.join(dir, 'bookmarks.json'), { v: 1, bookmarks: [] })
  }

  isBookmarked(url: string): boolean {
    return this.store.get().bookmarks.some((b) => b.url === url)
  }

  toggle(url: string, title: string, createdAt: number): boolean {
    const { bookmarks } = this.store.get()
    if (this.isBookmarked(url)) {
      this.store.set({ v: 1, bookmarks: bookmarks.filter((b) => b.url !== url) })
      return false
    }
    this.store.set({ v: 1, bookmarks: [{ url, title, createdAt }, ...bookmarks] })
    return true
  }

  list(): Bookmark[] {
    return this.store.get().bookmarks
  }

  flush(): void {
    this.store.flush()
  }
}
