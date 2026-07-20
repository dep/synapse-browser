import { acceleratorFromKeyEvent } from '../shared/accelerator'
import { AI_MODELS } from '../shared/ai'
import type { ShortcutRow } from '../shared/ipc'
import type { ProfileRule } from '../shared/profile-routing'

export type SettingsSection = 'general' | 'profiles' | 'shortcuts'

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
    { id: 'profiles', label: 'Profiles' },
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
    renderGeneralSection(body)
  } else if (section === 'profiles') {
    renderProfilesSection(body)
  } else {
    renderShortcutsSection(body)
  }

  el.append(nav, body)
}

function renderGeneralSection(body: HTMLElement): void {
  const group = document.createElement('div')
  group.className = 'settings-group'

  const heading = document.createElement('h2')
  heading.textContent = 'AI Assistant'
  group.append(heading)

  // API key row
  const keyRow = document.createElement('div')
  keyRow.className = 'settings-row'
  const keyLabel = document.createElement('label')
  keyLabel.textContent = 'Anthropic API key'
  keyLabel.htmlFor = 'setting-ai-key'
  const keyWrap = document.createElement('div')
  keyWrap.className = 'settings-key-wrap'
  const keyInput = document.createElement('input')
  keyInput.type = 'password'
  keyInput.id = 'setting-ai-key'
  keyInput.className = 'settings-input'
  keyInput.placeholder = 'sk-ant-…'
  keyInput.autocomplete = 'off'
  keyInput.spellcheck = false
  const reveal = document.createElement('button')
  reveal.className = 'settings-action'
  reveal.type = 'button'
  reveal.textContent = 'Show'
  reveal.addEventListener('click', () => {
    const hidden = keyInput.type === 'password'
    keyInput.type = hidden ? 'text' : 'password'
    reveal.textContent = hidden ? 'Hide' : 'Show'
  })
  keyWrap.append(keyInput, reveal)
  keyRow.append(keyLabel, keyWrap)

  // model row
  const modelRow = document.createElement('div')
  modelRow.className = 'settings-row'
  const modelLabel = document.createElement('label')
  modelLabel.textContent = 'Model'
  modelLabel.htmlFor = 'setting-ai-model'
  const modelSelect = document.createElement('select')
  modelSelect.id = 'setting-ai-model'
  modelSelect.className = 'settings-input'
  for (const m of AI_MODELS) {
    const opt = document.createElement('option')
    opt.value = m.id
    opt.textContent = m.label
    modelSelect.append(opt)
  }
  modelRow.append(modelLabel, modelSelect)

  const hint = document.createElement('p')
  hint.className = 'settings-hint'
  hint.append('Powers the AI sidebar. The key is stored locally on this machine. ')
  const consoleLink = document.createElement('button')
  consoleLink.className = 'settings-link'
  consoleLink.type = 'button'
  consoleLink.textContent = 'Get an API key ↗'
  consoleLink.addEventListener('click', () =>
    window.synapse.tabs.create('https://console.anthropic.com/settings/keys'),
  )
  hint.append(consoleLink)

  group.append(keyRow, modelRow, hint)
  body.append(group)

  void window.synapse.settings.get().then(({ apiKey, model }) => {
    keyInput.value = apiKey
    modelSelect.value = model
  })
  keyInput.addEventListener('change', () => {
    void window.synapse.settings.set({ apiKey: keyInput.value })
  })
  modelSelect.addEventListener('change', () => {
    void window.synapse.settings.set({ model: modelSelect.value })
  })
}

// profile auto-routing rules (issue #33): a CRUD list of pattern → profile
// rows. Edits save the whole list — the store debounces the disk write.
function renderProfilesSection(body: HTMLElement): void {
  const group = document.createElement('div')
  group.className = 'settings-group'

  const heading = document.createElement('h2')
  heading.textContent = 'Auto-routing rules'
  const hint = document.createElement('p')
  hint.className = 'settings-hint'
  hint.textContent =
    'A new tab whose URL contains a pattern opens in that rule’s profile. ' +
    'The first matching rule wins.'

  const list = document.createElement('div')
  list.id = 'profile-rules'

  const toolbar = document.createElement('div')
  toolbar.className = 'settings-toolbar'
  const add = document.createElement('button')
  add.className = 'settings-action'
  add.textContent = 'Add Rule'
  toolbar.append(add)

  group.append(heading, hint, list, toolbar)
  body.append(group)

  let rules: ProfileRule[] = []
  const save = (): void => void window.synapse.profileRules.save(rules)

  const render = (): void => {
    list.innerHTML = ''
    if (rules.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'settings-hint'
      empty.textContent = 'No rules yet — add one to route matching tabs into a profile.'
      list.append(empty)
      return
    }
    for (const rule of rules) {
      const row = document.createElement('div')
      row.className = 'settings-row rule-row'

      const pattern = document.createElement('input')
      pattern.className = 'settings-input rule-pattern'
      pattern.placeholder = 'e.g. github.com'
      pattern.autocomplete = 'off'
      pattern.spellcheck = false
      pattern.value = rule.pattern
      pattern.addEventListener('change', () => {
        rule.pattern = pattern.value.trim()
        save()
      })

      const profile = document.createElement('select')
      profile.className = 'settings-input rule-profile'
      for (const p of ['default', 'work'] as const) {
        const opt = document.createElement('option')
        opt.value = p
        opt.textContent = p === 'default' ? 'Default' : 'Work'
        profile.append(opt)
      }
      profile.value = rule.profile
      profile.addEventListener('change', () => {
        rule.profile = profile.value === 'work' ? 'work' : 'default'
        save()
      })

      const remove = document.createElement('button')
      remove.className = 'settings-action'
      remove.textContent = 'Remove'
      remove.addEventListener('click', () => {
        rules = rules.filter((r) => r !== rule)
        save()
        render()
      })

      row.append(pattern, profile, remove)
      list.append(row)
    }
  }

  add.addEventListener('click', () => {
    rules.push({ id: crypto.randomUUID(), pattern: '', profile: 'work' })
    render()
    const inputs = list.querySelectorAll<HTMLInputElement>('.rule-pattern')
    inputs[inputs.length - 1]?.focus()
  })

  void window.synapse.profileRules.list().then((r) => {
    rules = r
    render()
  })
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
      chip.addEventListener('click', () => beginRecording(chip, error, row, refresh))
    }
    list.append(item)
  }
}

function beginRecording(
  chip: HTMLButtonElement,
  error: HTMLElement,
  row: ShortcutRow,
  refresh: () => void,
): void {
  cancelRecording()
  window.synapse.shortcuts.setRecording(true)
  chip.classList.add('recording')
  chip.textContent = 'Press shortcut…'
  error.textContent = ''
  const current = row.accelerator
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
    void window.synapse.shortcuts.set(row.id, accel).then((result) => {
      if (result.ok) {
        refresh()
        return
      }
      // leave the row in place so the message stays visible; refresh() would
      // rebuild the list and destroy this error span immediately
      error.textContent = result.error ?? 'Could not set shortcut.'
      chip.textContent = current
    })
  }
  const cleanup = (): void => {
    window.removeEventListener('keydown', onKey, true)
    window.synapse.shortcuts.setRecording(false)
    chip.classList.remove('recording')
    cancelActiveRecording = null
  }
  cancelActiveRecording = cleanup
  window.addEventListener('keydown', onKey, true)
}
