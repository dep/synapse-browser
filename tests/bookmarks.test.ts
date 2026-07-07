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

  it('renameBookmark updates the title and nothing else', () => {
    store.toggle('https://a.com', 'A', 1)
    const before = store.list().bookmarks[0]!
    store.renameBookmark(before.id, 'Renamed')
    expect(store.list().bookmarks[0]).toEqual({ ...before, title: 'Renamed' })
  })

  it('renameBookmark with an unknown id is a no-op', () => {
    store.toggle('https://a.com', 'A', 1)
    store.renameBookmark('nope', 'X')
    expect(store.list().bookmarks[0]!.title).toBe('A')
  })

  it('addFolder appends and returns the folder', () => {
    const a = store.addFolder('Work')
    const b = store.addFolder('Play')
    expect(a.id).toBeTruthy()
    expect(store.list().folders.map((f) => f.name)).toEqual(['Work', 'Play'])
    expect(store.list().folders[1]!.id).toBe(b.id)
  })

  it('renameFolder renames in place', () => {
    const f = store.addFolder('Work')
    store.renameFolder(f.id, 'Werk')
    expect(store.list().folders).toEqual([{ id: f.id, name: 'Werk' }])
  })

  it('removeFolder removes an empty folder', () => {
    const f = store.addFolder('Work')
    store.toggle('https://out.com', 'Out', 1)
    store.removeFolder(f.id)
    expect(store.list().folders).toEqual([])
    expect(store.list().bookmarks.map((b) => b.url)).toEqual(['https://out.com'])
  })

  // toggle prepends, so toggling A,B,C yields order [C,B,A]; helper for clarity
  function seed(urls: string[]): string[] {
    for (const [i, url] of urls.entries()) store.toggle(url, url, i)
    const { bookmarks } = store.list()
    // return ids in the same order as `urls`
    return urls.map((u) => bookmarks.find((b) => b.url === u)!.id)
  }

  function urlsAt(folderId?: string): string[] {
    return store
      .list()
      .bookmarks.filter((b) => b.folderId === folderId)
      .map((b) => b.url)
  }

  it('reorder moves a bookmark within the top level', () => {
    seed(['a', 'b', 'c']) // top-level order: c, b, a
    const cId = store.list().bookmarks.find((b) => b.url === 'c')!.id
    store.reorder(cId, 2)
    expect(urlsAt()).toEqual(['b', 'a', 'c'])
  })

  it('reorder clamps out-of-range indices', () => {
    seed(['a', 'b'])
    const aId = store.list().bookmarks.find((b) => b.url === 'a')!.id
    store.reorder(aId, 99)
    expect(urlsAt()).toEqual(['b', 'a'])
    store.reorder(aId, -5)
    expect(urlsAt()).toEqual(['a', 'b'])
  })

  it('reorder moves a folder within the folder list', () => {
    const f1 = store.addFolder('One')
    store.addFolder('Two')
    store.addFolder('Three')
    store.reorder(f1.id, 2)
    expect(store.list().folders.map((f) => f.name)).toEqual(['Two', 'Three', 'One'])
  })

  it('moveToFolder appends when no index given', () => {
    const f = store.addFolder('F')
    const [aId, bId] = seed(['a', 'b'])
    store.moveToFolder(aId!, f.id)
    store.moveToFolder(bId!, f.id)
    expect(urlsAt(f.id)).toEqual(['a', 'b'])
    expect(urlsAt()).toEqual([])
  })

  it('moveToFolder places at a container-relative index', () => {
    const f = store.addFolder('F')
    const [aId, bId, cId] = seed(['a', 'b', 'c'])
    store.moveToFolder(aId!, f.id)
    store.moveToFolder(bId!, f.id)
    store.moveToFolder(cId!, f.id, 1) // between a and b
    expect(urlsAt(f.id)).toEqual(['a', 'c', 'b'])
  })

  it('moveToFolder(null) returns a bookmark to the top level', () => {
    const f = store.addFolder('F')
    const [aId] = seed(['a', 'b']) // top level: b, a
    store.moveToFolder(aId!, f.id)
    store.moveToFolder(aId!, null, 0)
    expect(urlsAt()).toEqual(['a', 'b'])
    expect(urlsAt(f.id)).toEqual([])
  })

  it('moveToFolder to a nonexistent folder is a no-op', () => {
    const [aId] = seed(['a'])
    store.moveToFolder(aId!, 'nope')
    expect(urlsAt()).toEqual(['a'])
    expect(store.list().bookmarks[0]!.folderId).toBeUndefined()
  })

  it('reorder inside a folder leaves other containers untouched', () => {
    const f = store.addFolder('F')
    const [aId, bId, cId] = seed(['a', 'b', 'c', 'x', 'y'])
    store.moveToFolder(aId!, f.id)
    store.moveToFolder(bId!, f.id)
    store.moveToFolder(cId!, f.id) // folder: a, b, c ; top level: y, x
    store.reorder(cId!, 0)
    expect(urlsAt(f.id)).toEqual(['c', 'a', 'b'])
    expect(urlsAt()).toEqual(['y', 'x'])
  })

  it('removeFolder deletes member bookmarks only', () => {
    const f = store.addFolder('F')
    const [aId] = seed(['a', 'b'])
    store.moveToFolder(aId!, f.id)
    store.removeFolder(f.id)
    expect(store.list().folders).toEqual([])
    expect(urlsAt()).toEqual(['b'])
  })

  it('add prepends at the top level and returns the bookmark', () => {
    const a = store.add('https://a.com', 'A', 1)
    const b = store.add('https://b.com', 'B', 2)
    expect(a.id).toBeTruthy()
    expect(a.profile).toBeUndefined()
    expect(store.list().bookmarks.map((x) => x.id)).toEqual([b.id, a.id])
    expect(store.get(a.id)).toEqual(a)
  })

  it('add with a work profile stores it; default stays absent', () => {
    const w = store.add('https://w.com', 'W', 1, 'work')
    const d = store.add('https://d.com', 'D', 2, 'default')
    expect(store.get(w.id)!.profile).toBe('work')
    expect(store.get(d.id)!.profile).toBeUndefined()
  })

  it('setProfile flips between work and default (default = field absent)', () => {
    const bm = store.add('https://a.com', 'A', 1)
    store.setProfile(bm.id, 'work')
    expect(store.get(bm.id)!.profile).toBe('work')
    store.setProfile(bm.id, 'default')
    expect(store.get(bm.id)!.profile).toBeUndefined()
  })

  it('setFavicon stores and clears', () => {
    const bm = store.add('https://a.com', 'A', 1)
    store.setFavicon(bm.id, 'https://a.com/i.png')
    expect(store.get(bm.id)!.favicon).toBe('https://a.com/i.png')
    store.setFavicon(bm.id, null)
    expect(store.get(bm.id)!.favicon).toBeUndefined()
  })

  it('setProfile and setFavicon on unknown ids are no-ops', () => {
    store.setProfile('nope', 'work')
    store.setFavicon('nope', 'x')
    expect(store.list().bookmarks).toEqual([])
  })

  it('ordered walks folder members in folder order, then top level', () => {
    const f1 = store.addFolder('One')
    const f2 = store.addFolder('Two')
    const a = store.add('https://a.com', 'a', 1)
    const b = store.add('https://b.com', 'b', 2)
    const c = store.add('https://c.com', 'c', 3) // top level: c, b, a
    store.moveToFolder(b.id, f2.id)
    store.moveToFolder(a.id, f1.id)
    expect(store.ordered().map((x) => x.title)).toEqual(['a', 'b', 'c'])
  })
})
