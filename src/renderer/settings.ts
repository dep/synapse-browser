import { acceleratorFromKeyEvent } from '../shared/accelerator'
import type { ShortcutRow } from '../shared/ipc'

export type SettingsSection = 'general' | 'shortcuts'

// only one chord recording can be live; re-renders and settings close must
// tear down its window-level capture listener or it would swallow keydowns
// app-wide forever
let cancelActiveRecording: (() => void) | null = null

export function cancelRecording(): void {
  cancelActiveRecording?.()
}

export function renderSettings(el: HTMLElement, section: SettingsSection): void {
  cancelRecording()
  el.innerHTML = ''
  const nav = document.createElement('nav')
  nav.id = 'settings-nav'
  const body = document.createElement('div')
  body.id = 'settings-body'

  const sections: Array<{ id: SettingsSection; label: string }> = [
    { id: 'general', label: 'General' },
    { id: 'shortcuts', label: 'Keyboard Shortcuts' },
  ]
  for (const s of sections) {
    const btn = document.createElement('button')
    btn.className = 'settings-nav-item' + (s.id === section ? ' active' : '')
    btn.textContent = s.label
    btn.addEventListener('click', () => renderSettings(el, s.id))
    nav.append(btn)
  }

  const heading = document.createElement('h1')
  heading.textContent = sections.find((s) => s.id === section)!.label
  body.append(heading)

  if (section === 'general') {
    const empty = document.createElement('p')
    empty.className = 'settings-empty'
    empty.textContent = 'No settings yet.'
    body.append(empty)
  } else {
    renderShortcutsSection(body)
  }

  el.append(nav, body)
}

function renderShortcutsSection(body: HTMLElement): void {
  const toolbar = document.createElement('div')
  toolbar.className = 'settings-toolbar'
  const resetAll = document.createElement('button')
  resetAll.className = 'settings-action'
  resetAll.textContent = 'Reset All'
  resetAll.addEventListener('click', () => {
    void window.synapse.shortcuts.resetAll().then(() => refresh())
  })
  toolbar.append(resetAll)

  const list = document.createElement('div')
  list.id = 'shortcut-list'
  body.append(toolbar, list)

  const refresh = (): void => {
    void window.synapse.shortcuts.list().then((rows) => renderRows(list, rows, refresh))
  }
  refresh()
}

function renderRows(list: HTMLElement, rows: ShortcutRow[], refresh: () => void): void {
  cancelRecording()
  list.innerHTML = ''
  for (const row of rows) {
    const item = document.createElement('div')
    item.className = 'shortcut-row'

    const label = document.createElement('span')
    label.className = 'shortcut-label'
    label.textContent = row.label

    const chip = document.createElement('button')
    chip.className = 'shortcut-chip' + (row.fixed ? ' fixed' : '')
    chip.textContent = row.accelerator
    chip.disabled = row.fixed
    if (row.fixed) chip.title = 'This shortcut is built in and cannot be changed'

    const error = document.createElement('span')
    error.className = 'shortcut-error'

    item.append(label, chip, error)

    if (!row.fixed) {
      if (row.accelerator !== row.default) {
        const reset = document.createElement('button')
        reset.className = 'settings-action'
        reset.textContent = 'Reset'
        reset.title = `Reset to ${row.default}`
        reset.addEventListener('click', () => {
          void window.synapse.shortcuts.reset(row.id).then(() => refresh())
        })
        item.append(reset)
      }
      chip.addEventListener('click', () => beginRecording(chip, error, row.id, refresh))
    }
    list.append(item)
  }
}

function beginRecording(
  chip: HTMLButtonElement,
  error: HTMLElement,
  id: string,
  refresh: () => void,
): void {
  chip.classList.add('recording')
  chip.textContent = 'Press shortcut…'
  error.textContent = ''
  const onKey = (e: KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      cleanup()
      refresh()
      return
    }
    const accel = acceleratorFromKeyEvent(e)
    if (!accel) return // ignore bare modifiers; keep recording
    cleanup()
    void window.synapse.shortcuts.set(id, accel).then((result) => {
      if (!result.ok) error.textContent = result.error ?? 'Could not set shortcut.'
      refresh()
    })
  }
  const cleanup = (): void => {
    window.removeEventListener('keydown', onKey, true)
    chip.classList.remove('recording')
    cancelActiveRecording = null
  }
  cancelActiveRecording = cleanup
  window.addEventListener('keydown', onKey, true)
}
