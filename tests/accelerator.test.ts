import { describe, expect, it } from 'vitest'
import { acceleratorFromKeyEvent, normalizeAccelerator } from '../src/shared/accelerator'

const ev = (over: Partial<Parameters<typeof acceleratorFromKeyEvent>[0]>) => ({
  key: 'a',
  code: 'KeyA',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
})

describe('acceleratorFromKeyEvent', () => {
  it('builds modifier+letter chords with canonical order', () => {
    expect(acceleratorFromKeyEvent(ev({ metaKey: true }))).toBe('Cmd+A')
    expect(
      acceleratorFromKeyEvent(ev({ ctrlKey: true, altKey: true, shiftKey: true, metaKey: true })),
    ).toBe('Control+Alt+Shift+Cmd+A')
  })

  it('rejects chords without a non-shift modifier (except F-keys)', () => {
    expect(acceleratorFromKeyEvent(ev({}))).toBeNull()
    expect(acceleratorFromKeyEvent(ev({ shiftKey: true }))).toBeNull()
    expect(acceleratorFromKeyEvent(ev({ key: 'F5', code: 'F5' }))).toBe('F5')
  })

  it('rejects pure modifier presses and Escape', () => {
    expect(acceleratorFromKeyEvent(ev({ key: 'Meta', code: 'MetaLeft', metaKey: true }))).toBeNull()
    expect(acceleratorFromKeyEvent(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBeNull()
    expect(acceleratorFromKeyEvent(ev({ key: 'Escape', code: 'Escape', metaKey: true }))).toBeNull()
  })

  it('normalizes arrows, space, plus and digits', () => {
    expect(acceleratorFromKeyEvent(ev({ key: 'ArrowUp', code: 'ArrowUp', altKey: true, metaKey: true }))).toBe(
      'Alt+Cmd+Up',
    )
    expect(acceleratorFromKeyEvent(ev({ key: ' ', code: 'Space', ctrlKey: true }))).toBe('Control+Space')
    expect(acceleratorFromKeyEvent(ev({ key: '+', code: 'Equal', metaKey: true, shiftKey: true }))).toBe(
      'Shift+Cmd+Plus',
    )
    expect(acceleratorFromKeyEvent(ev({ key: '!', code: 'Digit1', metaKey: true, shiftKey: true }))).toBe(
      'Shift+Cmd+1',
    )
  })

  it('passes punctuation through', () => {
    expect(acceleratorFromKeyEvent(ev({ key: ',', code: 'Comma', metaKey: true }))).toBe('Cmd+,')
    expect(acceleratorFromKeyEvent(ev({ key: '[', code: 'BracketLeft', metaKey: true }))).toBe('Cmd+[')
  })
})

describe('normalizeAccelerator', () => {
  it('maps CmdOrCtrl per platform', () => {
    expect(normalizeAccelerator('CmdOrCtrl+T', true)).toBe('Cmd+T')
    expect(normalizeAccelerator('CmdOrCtrl+T', false)).toBe('Control+T')
    expect(normalizeAccelerator('CommandOrControl+T', true)).toBe('Cmd+T')
  })

  it('canonicalizes aliases and case', () => {
    expect(normalizeAccelerator('command+shift+t', true)).toBe('Shift+Cmd+T')
    expect(normalizeAccelerator('Option+cmd+Up', true)).toBe('Alt+Cmd+Up')
  })

  it('detects equality across styles', () => {
    expect(normalizeAccelerator('CmdOrCtrl+=', true)).toBe(normalizeAccelerator('Cmd+=', true))
  })
})
