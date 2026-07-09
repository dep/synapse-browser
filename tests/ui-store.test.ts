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

  it('sidebarVisible defaults to true and round-trips false', () => {
    const store = new UiStore(dir)
    expect(store.sidebarVisible()).toBe(true)
    store.setSidebarVisible(false)
    store.flush()
    expect(new UiStore(dir).sidebarVisible()).toBe(false)
  })

  it('setSidebarWidth preserves sidebarVisible and vice versa', () => {
    const store = new UiStore(dir)
    store.setSidebarVisible(false)
    store.setSidebarWidth(300)
    store.flush()
    const again = new UiStore(dir)
    expect(again.sidebarVisible()).toBe(false)
    expect(again.sidebarWidth()).toBe(300)
  })

  it('treats non-boolean stored sidebarVisible as true', () => {
    fs.writeFileSync(
      path.join(dir, 'ui.json'),
      JSON.stringify({ v: 1, sidebarWidth: 240, sidebarVisible: 'nope' }),
    )
    expect(new UiStore(dir).sidebarVisible()).toBe(true)
  })

  it('aiSidebar defaults: hidden, 360 wide', () => {
    const store = new UiStore(dir)
    expect(store.aiSidebarVisible()).toBe(false)
    expect(store.aiSidebarWidth()).toBe(360)
  })

  it('round-trips ai sidebar state without touching the left sidebar', () => {
    const store = new UiStore(dir)
    store.setSidebarWidth(300)
    store.setAiSidebarVisible(true)
    store.setAiSidebarWidth(420)
    store.flush()
    const again = new UiStore(dir)
    expect(again.aiSidebarVisible()).toBe(true)
    expect(again.aiSidebarWidth()).toBe(420)
    expect(again.sidebarWidth()).toBe(300)
  })

  it('clamps ai sidebar width on read and treats non-boolean visible as false', () => {
    fs.writeFileSync(
      path.join(dir, 'ui.json'),
      JSON.stringify({ v: 1, aiSidebarWidth: 5, aiSidebarVisible: 'yes' }),
    )
    const store = new UiStore(dir)
    expect(store.aiSidebarWidth()).toBe(260)
    expect(store.aiSidebarVisible()).toBe(false)
  })

  it('legacy ui.json without ai fields reads as defaults', () => {
    fs.writeFileSync(
      path.join(dir, 'ui.json'),
      JSON.stringify({ v: 1, sidebarWidth: 240, sidebarVisible: true }),
    )
    const store = new UiStore(dir)
    expect(store.aiSidebarVisible()).toBe(false)
    expect(store.aiSidebarWidth()).toBe(360)
  })
})
