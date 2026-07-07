import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BookmarksStore } from '../src/main/bookmarks'

describe('BookmarksStore', () => {
  let dir: string
  let store: BookmarksStore

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-'))
    store = new BookmarksStore(dir)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('toggle adds a bookmark with an id and returns true', () => {
    expect(store.toggle('https://a.com', 'A', 1)).toBe(true)
    expect(store.isBookmarked('https://a.com')).toBe(true)
    const { bookmarks } = store.list()
    expect(bookmarks).toHaveLength(1)
    expect(bookmarks[0]!.id).toBeTruthy()
    expect(bookmarks[0]!.folderId).toBeUndefined()
  })

  it('toggle removes an existing bookmark and returns false', () => {
    store.toggle('https://a.com', 'A', 1)
    expect(store.toggle('https://a.com', 'A', 2)).toBe(false)
    expect(store.isBookmarked('https://a.com')).toBe(false)
    expect(store.list().bookmarks).toEqual([])
  })

  it('new bookmarks land at the top of the top level', () => {
    store.toggle('https://a.com', 'A', 1)
    store.toggle('https://b.com', 'B', 2)
    expect(store.list().bookmarks.map((b) => b.url)).toEqual(['https://b.com', 'https://a.com'])
  })

  it('remove deletes by id', () => {
    store.toggle('https://a.com', 'A', 1)
    store.toggle('https://b.com', 'B', 2)
    const id = store.list().bookmarks.find((b) => b.url === 'https://a.com')!.id
    store.remove(id)
    expect(store.list().bookmarks.map((b) => b.url)).toEqual(['https://b.com'])
  })

  it('migrates a v1 file: stamps ids, adds empty folders', () => {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'bookmarks.json'),
      JSON.stringify({
        v: 1,
        bookmarks: [{ url: 'https://old.com', title: 'Old', createdAt: 5 }],
      }),
    )
    const migrated = new BookmarksStore(dir)
    const { folders, bookmarks } = migrated.list()
    expect(folders).toEqual([])
    expect(bookmarks).toHaveLength(1)
    expect(bookmarks[0]!.url).toBe('https://old.com')
    expect(bookmarks[0]!.id).toBeTruthy()
  })

  it('persists via flush and reloads', () => {
    store.toggle('https://a.com', 'A', 1)
    store.flush()
    const reloaded = new BookmarksStore(dir)
    expect(reloaded.isBookmarked('https://a.com')).toBe(true)
    expect(reloaded.list().bookmarks[0]!.id).toBe(store.list().bookmarks[0]!.id)
  })
})
