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

  it('toggle adds a bookmark and returns true', () => {
    expect(store.toggle('https://a.com', 'A', 1)).toBe(true)
    expect(store.isBookmarked('https://a.com')).toBe(true)
    expect(store.list()).toHaveLength(1)
  })

  it('toggle removes an existing bookmark and returns false', () => {
    store.toggle('https://a.com', 'A', 1)
    expect(store.toggle('https://a.com', 'A', 2)).toBe(false)
    expect(store.isBookmarked('https://a.com')).toBe(false)
    expect(store.list()).toEqual([])
  })

  it('persists via flush and reloads', () => {
    store.toggle('https://a.com', 'A', 1)
    store.flush()
    const reloaded = new BookmarksStore(dir)
    expect(reloaded.isBookmarked('https://a.com')).toBe(true)
  })
})
