import type { TabsSnapshot } from '../shared/ipc'

export interface FindBar {
  update(snap: TabsSnapshot): void
  close(): void
}

// the bar lives in the topbar row, so it never fights the page view for
// space; main owns the find session, this module owns bar state + last query
export function initFindBar(): FindBar {
  const bar = document.getElementById('find-bar') as HTMLDivElement
  const input = document.getElementById('find-input') as HTMLInputElement
  const count = document.getElementById('find-count') as HTMLSpanElement
  const prev = document.getElementById('find-prev') as HTMLButtonElement
  const next = document.getElementById('find-next') as HTMLButtonElement
  const close = document.getElementById('find-close') as HTMLButtonElement
  let activeId: string | null = null
  let lastQuery = ''

  function open(): void {
    bar.hidden = false
    input.focus()
    input.select()
  }

  function closeBar(): void {
    if (bar.hidden) return
    bar.hidden = true
    count.textContent = ''
    window.synapse.find.stop()
  }

  function step(dir: 1 | -1): void {
    if (bar.hidden) {
      // Cmd+G with a closed bar re-opens the last search without claiming
      // keyboard focus — the page keeps it, matching macOS Cmd+G convention
      // (input.focus() here would be a lie: a page view holds native focus)
      if (!lastQuery) return
      bar.hidden = false
      input.value = lastQuery
      window.synapse.find.start(lastQuery)
      return
    }
    window.synapse.find.step(dir)
  }

  window.synapse.ui.onFindOpen(() => open())
  window.synapse.ui.onFindStep((dir) => step(dir))
  window.synapse.ui.onFindResult(({ matches, active }) => {
    if (bar.hidden) return
    count.textContent = `${matches > 0 ? active : 0} of ${matches}`
    count.classList.toggle('empty', matches === 0)
  })

  input.addEventListener('input', () => {
    lastQuery = input.value
    if (input.value) {
      window.synapse.find.start(input.value)
    } else {
      count.textContent = ''
      window.synapse.find.stop()
    }
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') step(e.shiftKey ? -1 : 1)
    else if (e.key === 'Escape') closeBar()
  })
  prev.addEventListener('click', () => step(-1))
  next.addEventListener('click', () => step(1))
  close.addEventListener('click', () => closeBar())

  return {
    update(snap) {
      if (snap.activeId !== activeId) {
        activeId = snap.activeId
        closeBar()
      }
    },
    close: closeBar,
  }
}
