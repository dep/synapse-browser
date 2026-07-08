import { describe, expect, it } from 'vitest'
import type { BookmarksData } from '../src/shared/ipc'
import { parseBookmarksExport, planImport } from '../src/shared/bookmarks-io'

const data = (over: Partial<BookmarksData> = {}): BookmarksData => ({
  folders: [],
  bookmarks: [],
  ...over,
})

const bm = (id: string, url: string, over: Record<string, unknown> = {}) => ({
  id,
  url,
  title: url,
  createdAt: 1,
  ...over,
})

describe('parseBookmarksExport', () => {
  it('accepts a valid export', () => {
    const text = JSON.stringify({
      v: 1,
      folders: [{ id: 'f1', name: 'Work' }],
      bookmarks: [bm('b1', 'https://a.com', { folderId: 'f1', profile: 'work' })],
    })
    const parsed = parseBookmarksExport(text)
    expect(parsed?.folders).toHaveLength(1)
    expect(parsed?.bookmarks[0]?.url).toBe('https://a.com')
    expect(parsed?.bookmarks[0]?.profile).toBe('work')
  })

  it('rejects malformed JSON, wrong version, and non-object shapes', () => {
    expect(parseBookmarksExport('{nope')).toBeNull()
    expect(parseBookmarksExport(JSON.stringify({ v: 2, folders: [], bookmarks: [] }))).toBeNull()
    expect(parseBookmarksExport(JSON.stringify([]))).toBeNull()
  })

  it('skips invalid items but keeps valid ones', () => {
    const text = JSON.stringify({
      v: 1,
      folders: [{ id: 'f1', name: 'Ok' }, { id: 'f2' }, 'junk'],
      bookmarks: [bm('b1', 'https://a.com'), { id: 'b2' }, 42],
    })
    const parsed = parseBookmarksExport(text)
    expect(parsed?.folders).toHaveLength(1)
    expect(parsed?.bookmarks).toHaveLength(1)
  })
})

describe('planImport', () => {
  it('creates missing folders and resolves bookmark folder names', () => {
    const incoming = data({
      folders: [{ id: 'f1', name: 'Work' }],
      bookmarks: [bm('b1', 'https://a.com', { folderId: 'f1' })],
    })
    const plan = planImport(data(), incoming)
    expect(plan.folders).toEqual(['Work'])
    expect(plan.bookmarks).toEqual([
      { url: 'https://a.com', title: 'https://a.com', profile: 'default', folderName: 'Work' },
    ])
    expect(plan.skipped).toBe(0)
  })

  it('matches existing folders by name instead of recreating', () => {
    const existing = data({ folders: [{ id: 'x', name: 'Work' }] })
    const incoming = data({
      folders: [{ id: 'f1', name: 'Work' }],
      bookmarks: [bm('b1', 'https://a.com', { folderId: 'f1' })],
    })
    const plan = planImport(existing, incoming)
    expect(plan.folders).toEqual([])
    expect(plan.bookmarks[0]?.folderName).toBe('Work')
  })

  it('skips duplicates against existing and within the import', () => {
    const existing = data({ bookmarks: [bm('e1', 'https://a.com')] })
    const incoming = data({
      bookmarks: [bm('b1', 'https://a.com'), bm('b2', 'https://a.com'), bm('b3', 'https://b.com')],
    })
    const plan = planImport(existing, incoming)
    expect(plan.bookmarks.map((b) => b.url)).toEqual(['https://b.com'])
    expect(plan.skipped).toBe(2)
  })

  it('treats same url in different folders as distinct', () => {
    const incoming = data({
      folders: [{ id: 'f1', name: 'Work' }],
      bookmarks: [bm('b1', 'https://a.com'), bm('b2', 'https://a.com', { folderId: 'f1' })],
    })
    const plan = planImport(data(), incoming)
    expect(plan.bookmarks).toHaveLength(2)
  })

  it('drops bookmarks pointing at unknown folder ids to top level', () => {
    const incoming = data({ bookmarks: [bm('b1', 'https://a.com', { folderId: 'ghost' })] })
    const plan = planImport(data(), incoming)
    expect(plan.bookmarks[0]?.folderName).toBeNull()
  })
})
