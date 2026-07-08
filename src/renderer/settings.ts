export type SettingsSection = 'general' | 'shortcuts'

export function renderSettings(el: HTMLElement, section: SettingsSection): void {
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

// placeholder until the shortcuts settings task fills it in
function renderShortcutsSection(body: HTMLElement): void {
  const empty = document.createElement('p')
  empty.className = 'settings-empty'
  empty.textContent = 'Coming soon.'
  body.append(empty)
}
