import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HistoryStore } from '../src/main/history'

describe('HistoryStore', () => {
  let dir: string
  let store: HistoryStore

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-'))
    store = new HistoryStore(dir)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('adds entries most-recent-first', () => {
    store.add('https://a.com', 'A', 1)
    store.add('https://b.com', 'B', 2)
    expect(store.list().map((e) => e.url)).toEqual(['https://b.com', 'https://a.com'])
  })

  it('ignores non-http(s) urls', () => {
    store.add('data:text/html,x', 'Error page', 1)
    store.add('about:blank', 'Blank', 2)
    expect(store.list()).toEqual([])
  })

  it('skips a consecutive duplicate of the newest entry', () => {
    store.add('https://a.com', 'A', 1)
    store.add('https://a.com', 'A again', 2)
    expect(store.list()).toHaveLength(1)
  })

  it('keeps one entry per non-consecutive revisit — the frequency signal', () => {
    store.add('https://a.com', 'A', 1)
    store.add('https://b.com', 'B', 2)
    store.add('https://a.com', 'A', 3)
    expect(store.list().filter((e) => e.url === 'https://a.com')).toHaveLength(2)
  })

  it('caps at 5000 entries', () => {
    for (let i = 0; i < 5001; i++) store.add(`https://site${i}.com`, `S${i}`, i)
    expect(store.list(6000)).toHaveLength(5000)
    expect(store.list(1)[0].url).toBe('https://site5000.com')
  })

  it('persists via flush and reloads', () => {
    store.add('https://a.com', 'A', 1)
    store.flush()
    const reloaded = new HistoryStore(dir)
    expect(reloaded.list()).toHaveLength(1)
  })

})
