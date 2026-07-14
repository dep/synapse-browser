import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FaviconStore } from '../src/main/favicons'

describe('FaviconStore', () => {
  let dir: string
  let store: FaviconStore

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'favicons-'))
    store = new FaviconStore(dir)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('stores by host and looks up any url on that host', () => {
    store.set('https://a.com/deep/page', 'https://a.com/icon.png')
    expect(store.get('https://a.com/other')).toBe('https://a.com/icon.png')
  })

  it('returns null for unknown hosts and unparseable urls', () => {
    expect(store.get('https://nope.com/')).toBeNull()
    expect(store.get('not a url')).toBeNull()
  })

  it('ignores null favicons and non-http(s) pages', () => {
    store.set('https://a.com/', null)
    store.set('about:blank', 'https://x.com/i.png')
    expect(store.get('https://a.com/')).toBeNull()
    expect(store.get('about:blank')).toBeNull()
  })

  it('a newer favicon replaces the old one', () => {
    store.set('https://a.com/', 'old.png')
    store.set('https://a.com/', 'new.png')
    expect(store.get('https://a.com/')).toBe('new.png')
  })

  it('caps at 2000 hosts, dropping the oldest', () => {
    for (let i = 0; i < 2001; i++) store.set(`https://h${i}.com/`, `icon${i}`)
    expect(store.get('https://h0.com/')).toBeNull()
    expect(store.get('https://h1.com/')).toBe('icon1')
    expect(store.get('https://h2000.com/')).toBe('icon2000')
  })

  it('re-setting a host refreshes its cap position', () => {
    store.set('https://keep.com/', 'keep.png')
    for (let i = 0; i < 1999; i++) store.set(`https://h${i}.com/`, `icon${i}`)
    store.set('https://keep.com/', 'keep.png') // refresh: now newest
    store.set('https://newer.com/', 'newer.png') // evicts h0, not keep
    expect(store.get('https://keep.com/')).toBe('keep.png')
    expect(store.get('https://h0.com/')).toBeNull()
  })

  it('persists via flush and reloads', () => {
    store.set('https://a.com/', 'i.png')
    store.flush()
    expect(new FaviconStore(dir).get('https://a.com/')).toBe('i.png')
  })

  it('recovers from a corrupt file', () => {
    fs.writeFileSync(path.join(dir, 'favicons.json'), '{nope')
    const s2 = new FaviconStore(dir)
    expect(s2.get('https://a.com/')).toBeNull()
    expect(fs.existsSync(path.join(dir, 'favicons.json.bad'))).toBe(true)
  })
})
