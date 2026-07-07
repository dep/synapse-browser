import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TabsStore } from '../src/main/tabs-store'

describe('TabsStore', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabsstore-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('starts empty with no saved file', () => {
    expect(new TabsStore(dir).load()).toEqual({ tabs: [], active: -1 })
  })

  it('round-trips urls, profiles, and active index across instances', () => {
    const store = new TabsStore(dir)
    const tabs = [
      { url: 'https://a.test/', profile: 'default' as const },
      { url: 'https://b.test/', profile: 'work' as const },
    ]
    store.save(tabs, 1)
    store.flush()
    expect(new TabsStore(dir).load()).toEqual({ tabs, active: 1 })
  })

  it('keeps non-web urls as blank-tab placeholders', () => {
    const store = new TabsStore(dir)
    store.save(
      [
        { url: '', profile: 'default' },
        { url: 'data:text/html,error', profile: 'work' },
        { url: 'https://ok.test/', profile: 'default' },
        { url: 'about:blank', profile: 'default' },
      ],
      2,
    )
    expect(store.load().tabs.map((t) => t.url)).toEqual(['', '', 'https://ok.test/', ''])
  })

  it('clamps a stale active index into range', () => {
    const store = new TabsStore(dir)
    store.save([{ url: 'https://a.test/', profile: 'default' }], 5)
    expect(store.load().active).toBe(0)
    store.save([{ url: 'https://a.test/', profile: 'default' }], -1)
    expect(store.load().active).toBe(0)
  })

  it('loads a v1 file (urls array) as default-profile tabs', () => {
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({ v: 1, urls: ['https://a.test/', 'https://b.test/'], active: 1 }),
    )
    expect(new TabsStore(dir).load()).toEqual({
      tabs: [
        { url: 'https://a.test/', profile: 'default' },
        { url: 'https://b.test/', profile: 'default' },
      ],
      active: 1,
    })
  })

  it('ignores malformed contents from a hand-edited file', () => {
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({
        v: 2,
        tabs: [{ url: 'https://a.test/', profile: 'nonsense' }, { url: 42 }, 'junk', null],
        active: 'x',
      }),
    )
    expect(new TabsStore(dir).load()).toEqual({
      tabs: [{ url: 'https://a.test/', profile: 'default' }],
      active: 0,
    })
  })

  it('recovers from a corrupt file', () => {
    fs.writeFileSync(path.join(dir, 'tabs.json'), '{nope')
    expect(new TabsStore(dir).load()).toEqual({ tabs: [], active: -1 })
    expect(fs.existsSync(path.join(dir, 'tabs.json.bad'))).toBe(true)
  })

  it('round-trips a bookmark anchor', () => {
    const store = new TabsStore(dir)
    store.save(
      [{ url: 'https://a.test/deep', profile: 'default', anchor: 'https://a.test/' }],
      0,
    )
    store.flush()
    expect(new TabsStore(dir).load().tabs[0]!.anchor).toBe('https://a.test/')
  })

  it('drops non-http anchors on save and load', () => {
    const store = new TabsStore(dir)
    store.save([{ url: 'https://a.test/', profile: 'default', anchor: 'about:blank' }], 0)
    store.flush()
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'tabs.json'), 'utf8'))
    expect('anchor' in raw.tabs[0]).toBe(false)
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({
        v: 2,
        tabs: [{ url: 'https://a.test/', profile: 'default', anchor: 42 }],
        active: 0,
      }),
    )
    expect(new TabsStore(dir).load().tabs[0]!.anchor).toBeUndefined()
  })
})
