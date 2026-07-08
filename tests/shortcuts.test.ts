import { describe, expect, it } from 'vitest'
import { SHORTCUT_COMMANDS, resolveShortcuts } from '../src/shared/shortcuts'

describe('resolveShortcuts', () => {
  it('returns every command default when no overrides', () => {
    const resolved = resolveShortcuts({})
    expect(Object.keys(resolved).sort()).toEqual(SHORTCUT_COMMANDS.map((c) => c.id).sort())
    expect(resolved['new-tab']).toBe('CmdOrCtrl+T')
    expect(resolved['toggle-sidebar']).toBe('Control+S')
    expect(resolved['settings']).toBe('CmdOrCtrl+,')
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
})
