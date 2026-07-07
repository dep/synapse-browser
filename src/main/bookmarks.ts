import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import type { Bookmark, BookmarkFolder, BookmarksData } from '../shared/ipc'
import { JsonStore } from './store'

interface BookmarksFileV1 {
  v: 1
  bookmarks: { url: string; title: string; createdAt: number }[]
}

interface BookmarksFileV2 {
  v: 2
  folders: BookmarkFolder[]
  bookmarks: Bookmark[]
}

type BookmarksFile = BookmarksFileV1 | BookmarksFileV2

export class BookmarksStore {
  private store: JsonStore<BookmarksFile>

  constructor(dir: string) {
    this.store = new JsonStore<BookmarksFile>(path.join(dir, 'bookmarks.json'), {
      v: 2,
      folders: [],
      bookmarks: [],
    })
    const data = this.store.get()
    if (data.v === 1) {
      // v1 carried a flat list without ids or folders
      this.store.set({
        v: 2,
        folders: [],
        bookmarks: data.bookmarks.map((b) => ({ ...b, id: randomUUID() })),
      })
    }
  }

  // the constructor migrates v1 files, so reads are always v2
  private get data(): BookmarksFileV2 {
    return this.store.get() as BookmarksFileV2
  }

  isBookmarked(url: string): boolean {
    return this.data.bookmarks.some((b) => b.url === url)
  }

  toggle(url: string, title: string, createdAt: number): boolean {
    const { folders, bookmarks } = this.data
    if (this.isBookmarked(url)) {
      this.store.set({ v: 2, folders, bookmarks: bookmarks.filter((b) => b.url !== url) })
      return false
    }
    this.store.set({
      v: 2,
      folders,
      bookmarks: [{ id: randomUUID(), url, title, createdAt }, ...bookmarks],
    })
    return true
  }

  remove(id: string): void {
    const { folders, bookmarks } = this.data
    this.store.set({ v: 2, folders, bookmarks: bookmarks.filter((b) => b.id !== id) })
  }

  list(): BookmarksData {
    const { folders, bookmarks } = this.data
    return { folders, bookmarks }
  }

  flush(): void {
    this.store.flush()
  }
}
