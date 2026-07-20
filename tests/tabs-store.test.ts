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
    expect(new TabsStore(dir).load()).toEqual({ tabs: [], active: -1, groups: [] })
  })

  it('round-trips urls, profiles, and active index across instances', () => {
    const store = new TabsStore(dir)
    const tabs = [
      { url: 'https://a.test/', profile: 'default' as const },
      { url: 'https://b.test/', profile: 'work' as const },
    ]
    store.save(tabs, 1)
    store.flush()
    expect(new TabsStore(dir).load()).toEqual({ tabs, active: 1, groups: [] })
  })

  it('round-trips a custom title and drops absent ones', () => {
    const store = new TabsStore(dir)
    store.save(
      [
        { url: 'https://a.test/', profile: 'default', title: 'My Tab' },
        { url: 'https://b.test/', profile: 'work' },
      ],
      0,
    )
    store.flush()
    expect(new TabsStore(dir).load().tabs).toEqual([
      { url: 'https://a.test/', profile: 'default', title: 'My Tab' },
      { url: 'https://b.test/', profile: 'work' },
    ])
  })

  it('loads a v2 file (no titles) unchanged', () => {
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({ v: 2, tabs: [{ url: 'https://a.test/', profile: 'work' }], active: 0 }),
    )
    expect(new TabsStore(dir).load()).toEqual({
      tabs: [{ url: 'https://a.test/', profile: 'work' }],
      active: 0,
      groups: [],
    })
  })

  it('ignores a malformed title from a hand-edited file', () => {
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({
        v: 3,
        tabs: [
          { url: 'https://a.test/', profile: 'default', title: 42 },
          { url: 'https://b.test/', profile: 'default', title: '' },
        ],
        active: 0,
      }),
    )
    expect(new TabsStore(dir).load().tabs).toEqual([
      { url: 'https://a.test/', profile: 'default' },
      { url: 'https://b.test/', profile: 'default' },
    ])
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
      groups: [],
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
      groups: [],
    })
  })

  it('recovers from a corrupt file', () => {
    fs.writeFileSync(path.join(dir, 'tabs.json'), '{nope')
    expect(new TabsStore(dir).load()).toEqual({ tabs: [], active: -1, groups: [] })
    expect(fs.existsSync(path.join(dir, 'tabs.json.bad'))).toBe(true)
  })
})

describe('TabsStore tab groups', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabsstore-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips group membership and group meta', () => {
    const store = new TabsStore(dir)
    store.save(
      [
        { url: 'https://a.test/', profile: 'default', group: 'g1' },
        { url: 'https://b.test/', profile: 'work', group: 'g1' },
        { url: 'https://c.test/', profile: 'default' },
      ],
      0,
      [{ id: 'g1', name: 'Research', profile: 'work' }],
    )
    store.flush()
    const loaded = new TabsStore(dir).load()
    expect(loaded.tabs.map((t) => t.group ?? null)).toEqual(['g1', 'g1', null])
    expect(loaded.groups).toEqual([{ id: 'g1', name: 'Research', profile: 'work' }])
  })

  it('drops group refs that point at no saved group', () => {
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({
        v: 4,
        tabs: [{ url: 'https://a.test/', profile: 'default', group: 'ghost' }],
        groups: [],
        active: 0,
      }),
    )
    expect(new TabsStore(dir).load().tabs).toEqual([
      { url: 'https://a.test/', profile: 'default' },
    ])
  })

  it('ignores malformed groups from a hand-edited file', () => {
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({
        v: 4,
        tabs: [{ url: 'https://a.test/', profile: 'default', group: 'g1' }],
        groups: [{ id: 'g1', name: 'Ok' }, { id: 42, name: 'bad' }, 'junk', { id: 'g2' }],
        active: 0,
      }),
    )
    const loaded = new TabsStore(dir).load()
    expect(loaded.groups).toEqual([{ id: 'g1', name: 'Ok' }])
    expect(loaded.tabs[0]).toEqual({ url: 'https://a.test/', profile: 'default', group: 'g1' })
  })

  it('round-trips a group color and drops absent ones', () => {
    const store = new TabsStore(dir)
    store.save(
      [
        { url: 'https://a.test/', profile: 'default', group: 'g1' },
        { url: 'https://b.test/', profile: 'default', group: 'g2' },
      ],
      0,
      [
        { id: 'g1', name: 'Colored', color: 'blue' },
        { id: 'g2', name: 'Plain' },
      ],
    )
    store.flush()
    expect(new TabsStore(dir).load().groups).toEqual([
      { id: 'g1', name: 'Colored', color: 'blue' },
      { id: 'g2', name: 'Plain' },
    ])
  })

  it('ignores an unknown group color from a hand-edited file', () => {
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({
        v: 4,
        tabs: [{ url: 'https://a.test/', profile: 'default', group: 'g1' }],
        groups: [
          { id: 'g1', name: 'Ok', color: 'hotdog' },
          { id: 'g2', name: 'Num', color: 42 },
        ],
        active: 0,
      }),
    )
    expect(new TabsStore(dir).load().groups).toEqual([
      { id: 'g1', name: 'Ok' },
      { id: 'g2', name: 'Num' },
    ])
  })

  it('loads v3 files (no groups) with an empty group list', () => {
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({ v: 3, tabs: [{ url: 'https://a.test/', profile: 'default' }], active: 0 }),
    )
    expect(new TabsStore(dir).load().groups).toEqual([])
  })
})
