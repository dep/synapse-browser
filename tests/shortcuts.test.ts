import { describe, expect, it } from 'vitest'
import { RESERVED_ACCELERATORS, SHORTCUT_COMMANDS, resolveShortcuts } from '../src/shared/shortcuts'

describe('resolveShortcuts', () => {
  it('returns every command default when no overrides', () => {
    const resolved = resolveShortcuts({})
    expect(Object.keys(resolved).sort()).toEqual(SHORTCUT_COMMANDS.map((c) => c.id).sort())
    expect(resolved['new-tab']).toBe('CmdOrCtrl+T')
    expect(resolved['toggle-sidebar']).toBe('Control+S')
    expect(resolved['settings']).toBe('CmdOrCtrl+,')
    expect(resolved['find']).toBe('CmdOrCtrl+F')
    expect(resolved['find-next']).toBe('CmdOrCtrl+G')
    expect(resolved['find-prev']).toBe('CmdOrCtrl+Shift+G')
  })

  it('applies overrides for known ids', () => {
    expect(resolveShortcuts({ 'zoom-in': 'Cmd+Shift+I' })['zoom-in']).toBe('Cmd+Shift+I')
  })

  it('ignores unknown ids and non-string values', () => {
    const resolved = resolveShortcuts({ nope: 'Cmd+X', 'zoom-out': 7 as unknown as string })
    expect(resolved['nope']).toBeUndefined()
    expect(resolved['zoom-out']).toBe('CmdOrCtrl+-')
  })

  it('has unique ids and non-empty defaults', () => {
    const ids = SHORTCUT_COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of SHORTCUT_COMMANDS) expect(c.default.length).toBeGreaterThan(0)
  })

  it('no two commands share a default accelerator', () => {
    const defaults = SHORTCUT_COMMANDS.map((c) => c.default)
    expect(new Set(defaults).size).toBe(defaults.length)
  })

  it('bookmarking moved to Cmd+B, freeing Cmd+D for the vertical split', () => {
    const resolved = resolveShortcuts({})
    expect(resolved['bookmark-page']).toBe('CmdOrCtrl+B')
    expect(resolved['split-vertical']).toBe('CmdOrCtrl+D')
    expect(resolved['split-horizontal']).toBe('CmdOrCtrl+Shift+D')
  })
})

describe('RESERVED_ACCELERATORS', () => {
  it('covers the role accelerators and the tab-switch block', () => {
    expect(RESERVED_ACCELERATORS.has('Cmd+Q')).toBe(true)
    expect(RESERVED_ACCELERATORS.has('Cmd+1')).toBe(true)
    expect(RESERVED_ACCELERATORS.has('Cmd+9')).toBe(true)
    expect(RESERVED_ACCELERATORS.has('Cmd+T')).toBe(false)
  })
})
