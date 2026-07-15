import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import type { Bookmark, BookmarkFolder, BookmarksData, ProfileId } from '../shared/ipc'
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

  add(url: string, title: string, createdAt: number, profile: ProfileId = 'default'): Bookmark {
    const { folders, bookmarks } = this.data
    const bm: Bookmark = {
      id: randomUUID(),
      url,
      title,
      createdAt,
      ...(profile !== 'default' ? { profile } : {}),
    }
    this.store.set({ v: 2, folders, bookmarks: [...bookmarks, bm] })
    return bm
  }

  // a bookmark without its own profile inherits its folder's; resolution
  // happens at every read boundary so the stored data stays normalized
  // (profile fields only where explicitly set) while all consumers — slot
  // seeding, wake, suggestions, the renderer — see the effective profile
  private resolve(bm: Bookmark, folders: BookmarkFolder[]): Bookmark {
    if (bm.profile || !bm.folderId) return bm
    const inherited = folders.find((f) => f.id === bm.folderId)?.profile
    return inherited ? { ...bm, profile: inherited } : bm
  }

  get(id: string): Bookmark | undefined {
    const { folders, bookmarks } = this.data
    const bm = bookmarks.find((b) => b.id === id)
    return bm && this.resolve(bm, folders)
  }

  setProfile(id: string, profile: ProfileId): void {
    this.patch(id, (b) => {
      if (profile === 'default') delete b.profile
      else b.profile = profile
    })
  }

  setFavicon(id: string, favicon: string | null): void {
    this.patch(id, (b) => {
      if (favicon) b.favicon = favicon
      else delete b.favicon
    })
  }

  private patch(id: string, mutate: (b: Bookmark) => void): void {
    const { folders, bookmarks } = this.data
    this.store.set({
      v: 2,
      folders,
      bookmarks: bookmarks.map((b) => {
        if (b.id !== id) return b
        const next = { ...b }
        mutate(next)
        return next
      }),
    })
  }

  // sidebar visual order: each folder's members in folder order, then top level
  ordered(): Bookmark[] {
    const { folders, bookmarks } = this.data
    return [
      ...folders.flatMap((f) =>
        bookmarks.filter((b) => b.folderId === f.id).map((b) => this.resolve(b, folders)),
      ),
      ...bookmarks.filter((b) => !b.folderId),
    ]
  }

  remove(id: string): void {
    const { folders, bookmarks } = this.data
    this.store.set({ v: 2, folders, bookmarks: bookmarks.filter((b) => b.id !== id) })
  }

  renameBookmark(id: string, title: string): void {
    this.patch(id, (b) => {
      b.title = title
    })
  }

  addFolder(name: string, profile: ProfileId = 'default'): BookmarkFolder {
    const { folders, bookmarks } = this.data
    const folder: BookmarkFolder = {
      id: randomUUID(),
      name,
      ...(profile !== 'default' ? { profile } : {}),
    }
    this.store.set({ v: 2, folders: [...folders, folder], bookmarks })
    return folder
  }

  setFolderProfile(id: string, profile: ProfileId): void {
    const { folders, bookmarks } = this.data
    this.store.set({
      v: 2,
      folders: folders.map((f) => {
        if (f.id !== id) return f
        const next = { ...f }
        if (profile === 'default') delete next.profile
        else next.profile = profile
        return next
      }),
      bookmarks,
    })
  }

  renameFolder(id: string, name: string): void {
    const { folders, bookmarks } = this.data
    this.store.set({
      v: 2,
      folders: folders.map((f) => (f.id === id ? { ...f, name } : f)),
      bookmarks,
    })
  }

  // deleting a folder deletes its bookmarks too (confirmed UX decision)
  removeFolder(id: string): void {
    const { folders, bookmarks } = this.data
    this.store.set({
      v: 2,
      folders: folders.filter((f) => f.id !== id),
      bookmarks: bookmarks.filter((b) => b.folderId !== id),
    })
  }

  // toIndex is container-relative for bookmarks, folder-list-relative for folders
  reorder(id: string, toIndex: number): void {
    const { folders, bookmarks } = this.data
    const folderIdx = folders.findIndex((f) => f.id === id)
    if (folderIdx !== -1) {
      const next = [...folders]
      const [folder] = next.splice(folderIdx, 1)
      next.splice(Math.max(0, Math.min(Math.round(toIndex), next.length)), 0, folder!)
      this.store.set({ v: 2, folders: next, bookmarks })
      return
    }
    const bookmark = bookmarks.find((b) => b.id === id)
    if (bookmark) this.place(bookmark, bookmark.folderId, toIndex)
  }

  moveToFolder(id: string, folderId: string | null, toIndex = Number.MAX_SAFE_INTEGER): void {
    const { folders, bookmarks } = this.data
    if (folderId !== null && !folders.some((f) => f.id === folderId)) return
    const bookmark = bookmarks.find((b) => b.id === id)
    if (bookmark) this.place(bookmark, folderId ?? undefined, toIndex)
  }

  // container membership is folderId; order within a container is the members'
  // relative order in the global bookmarks array, so placing = remove + insert
  // adjacent to the member currently at the target slot
  private place(bookmark: Bookmark, folderId: string | undefined, toIndex: number): void {
    const { folders, bookmarks } = this.data
    const rest = bookmarks.filter((b) => b.id !== bookmark.id)
    const moved: Bookmark = { ...bookmark }
    if (folderId === undefined) delete moved.folderId
    else moved.folderId = folderId
    const members = rest.filter((b) => b.folderId === folderId)
    const clamped = Math.max(0, Math.min(Math.round(toIndex), members.length))
    const insertAt =
      clamped >= members.length
        ? members.length === 0
          ? rest.length
          : rest.indexOf(members[members.length - 1]!) + 1
        : rest.indexOf(members[clamped]!)
    rest.splice(insertAt, 0, moved)
    this.store.set({ v: 2, folders, bookmarks: rest })
  }

  list(): BookmarksData {
    const { folders, bookmarks } = this.data
    return { folders, bookmarks: bookmarks.map((b) => this.resolve(b, folders)) }
  }

  flush(): void {
    this.store.flush()
  }
}
