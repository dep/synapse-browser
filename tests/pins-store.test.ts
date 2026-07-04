import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PinsStore } from '../src/main/pins-store'

describe('PinsStore', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinsstore-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('starts empty with no saved file', () => {
    expect(new PinsStore(dir).load()).toEqual([])
  })

  it('round-trips pin slots across instances', () => {
    const store = new PinsStore(dir)
    const pins = [
      { url: 'https://a.test/', title: 'A', favicon: 'https://a.test/icon.png' },
      { url: 'https://b.test/', title: 'B', favicon: null },
    ]
    store.save(pins)
    store.flush()
    expect(new PinsStore(dir).load()).toEqual(pins)
  })

  it('drops non-web urls on save', () => {
    const store = new PinsStore(dir)
    store.save([
      { url: 'about:blank', title: 'x', favicon: null },
      { url: 'https://ok.test/', title: 'ok', favicon: null },
      { url: 'data:text/html,hi', title: 'y', favicon: null },
    ])
    expect(store.load()).toEqual([{ url: 'https://ok.test/', title: 'ok', favicon: null }])
  })

  it('ignores malformed entries from a hand-edited file', () => {
    fs.writeFileSync(
      path.join(dir, 'pins.json'),
      JSON.stringify({
        v: 1,
        pins: [
          { url: 'https://ok.test/', title: 42, favicon: 7 },
          { title: 'no url' },
          'nonsense',
          null,
        ],
      }),
    )
    expect(new PinsStore(dir).load()).toEqual([
      { url: 'https://ok.test/', title: 'https://ok.test/', favicon: null },
    ])
  })

  it('recovers from a corrupt file', () => {
    fs.writeFileSync(path.join(dir, 'pins.json'), '{nope')
    expect(new PinsStore(dir).load()).toEqual([])
    expect(fs.existsSync(path.join(dir, 'pins.json.bad'))).toBe(true)
  })
})
