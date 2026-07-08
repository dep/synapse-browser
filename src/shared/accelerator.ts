export interface KeyEventLike {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta'])

const KEY_NAMES: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
  '+': 'Plus',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
}

function keyName(e: KeyEventLike): string | null {
  if (MODIFIER_KEYS.has(e.key) || e.key === 'Escape') return null
  // digits by physical key so Shift+1 records as 1, not !
  const digit = /^Digit(\d)$/.exec(e.code)
  if (digit) return digit[1]!
  if (KEY_NAMES[e.key]) return KEY_NAMES[e.key]!
  if (/^F([1-9]|1\d|2[0-4])$/.test(e.key)) return e.key
  if (e.key.length === 1) return /[a-z]/i.test(e.key) ? e.key.toUpperCase() : e.key
  return null
}

// build an Electron accelerator from a renderer KeyboardEvent; null when the
// chord isn't recordable (no non-shift modifier, pure modifier press, Esc)
export function acceleratorFromKeyEvent(e: KeyEventLike): string | null {
  const key = keyName(e)
  if (!key) return null
  const isFKey = /^F([1-9]|1\d|2[0-4])$/.test(key)
  if (!isFKey && !e.ctrlKey && !e.altKey && !e.metaKey) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Control')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Cmd')
  parts.push(key)
  return parts.join('+')
}

const MOD_ORDER = ['Control', 'Alt', 'Shift', 'Cmd']

// canonical form for comparing two accelerators for conflicts
export function normalizeAccelerator(accel: string, isMac: boolean): string {
  // a trailing literal + is the Plus key ('Cmd++' or '+'), not a separator
  const plusKey = /(^|\+)\s*\+\s*$/.test(accel)
  const parts = accel
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (plusKey) parts.push('Plus')
  const mods: string[] = []
  let key = ''
  for (const raw of parts) {
    const p = raw.toLowerCase()
    if (p === 'cmdorctrl' || p === 'commandorcontrol') mods.push(isMac ? 'Cmd' : 'Control')
    else if (p === 'cmd' || p === 'command' || p === 'super' || p === 'meta') mods.push('Cmd')
    else if (p === 'control' || p === 'ctrl') mods.push('Control')
    else if (p === 'alt' || p === 'option' || p === 'altgr') mods.push('Alt')
    else if (p === 'shift') mods.push('Shift')
    else key = raw.length === 1 ? raw.toUpperCase() : raw[0]!.toUpperCase() + raw.slice(1)
  }
  const ordered = MOD_ORDER.filter((m) => mods.includes(m))
  return [...ordered, key].join('+')
}
