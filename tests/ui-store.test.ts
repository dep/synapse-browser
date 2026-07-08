import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UiStore } from '../src/main/ui-store'

describe('UiStore', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uistore-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('defaults to 240 when no file exists', () => {
    expect(new UiStore(dir).sidebarWidth()).toBe(240)
  })

  it('round-trips a width through disk', () => {
    const store = new UiStore(dir)
    store.setSidebarWidth(320)
    store.flush()
    expect(new UiStore(dir).sidebarWidth()).toBe(320)
  })

  it('clamps out-of-range stored values on read', () => {
    fs.writeFileSync(path.join(dir, 'ui.json'), JSON.stringify({ v: 1, sidebarWidth: 9999 }))
    expect(new UiStore(dir).sidebarWidth()).toBe(480)
  })

  it('clamps on write', () => {
    const store = new UiStore(dir)
    store.setSidebarWidth(10)
    expect(store.sidebarWidth()).toBe(180)
  })

  it('falls back to the default on non-numeric stored value', () => {
    fs.writeFileSync(path.join(dir, 'ui.json'), JSON.stringify({ v: 1, sidebarWidth: 'wide' }))
    expect(new UiStore(dir).sidebarWidth()).toBe(240)
  })
})
