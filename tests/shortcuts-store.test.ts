import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShortcutsStore } from '../src/main/shortcuts-store'

describe('ShortcutsStore', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('resolves to defaults when empty', () => {
    expect(new ShortcutsStore(dir).resolved()['new-tab']).toBe('CmdOrCtrl+T')
  })

  it('set() overrides and round-trips through disk', () => {
    const store = new ShortcutsStore(dir)
    store.set('new-tab', 'Cmd+Shift+T')
    store.flush()
    expect(new ShortcutsStore(dir).resolved()['new-tab']).toBe('Cmd+Shift+T')
  })

  it('reset() removes a single override', () => {
    const store = new ShortcutsStore(dir)
    store.set('new-tab', 'Cmd+Shift+T')
    store.set('history', 'Cmd+H')
    store.reset('new-tab')
    expect(store.resolved()['new-tab']).toBe('CmdOrCtrl+T')
    expect(store.resolved()['history']).toBe('Cmd+H')
  })

  it('resetAll() removes every override', () => {
    const store = new ShortcutsStore(dir)
    store.set('new-tab', 'Cmd+Shift+T')
    store.resetAll()
    expect(store.overrides()).toEqual({})
  })
})
