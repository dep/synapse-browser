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
    expect(new TabsStore(dir).load()).toEqual({ urls: [], active: -1 })
  })

  it('round-trips urls and active index across instances', () => {
    const store = new TabsStore(dir)
    store.save(['https://a.test/', 'https://b.test/'], 1)
    store.flush()
    expect(new TabsStore(dir).load()).toEqual({ urls: ['https://a.test/', 'https://b.test/'], active: 1 })
  })

  it('keeps non-web urls as blank-tab placeholders', () => {
    const store = new TabsStore(dir)
    store.save(['', 'data:text/html,error', 'https://ok.test/', 'about:blank'], 2)
    expect(store.load().urls).toEqual(['', '', 'https://ok.test/', ''])
  })

  it('clamps a stale active index into range', () => {
    const store = new TabsStore(dir)
    store.save(['https://a.test/'], 5)
    expect(store.load().active).toBe(0)
    store.save(['https://a.test/'], -1)
    expect(store.load().active).toBe(0)
  })

  it('ignores malformed contents from a hand-edited file', () => {
    fs.writeFileSync(path.join(dir, 'tabs.json'), JSON.stringify({ v: 1, urls: ['https://a.test/', 42], active: 'x' }))
    expect(new TabsStore(dir).load()).toEqual({ urls: ['https://a.test/'], active: 0 })
  })

  it('recovers from a corrupt file', () => {
    fs.writeFileSync(path.join(dir, 'tabs.json'), '{nope')
    expect(new TabsStore(dir).load()).toEqual({ urls: [], active: -1 })
    expect(fs.existsSync(path.join(dir, 'tabs.json.bad'))).toBe(true)
  })
})
