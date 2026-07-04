import type { TabsSnapshot } from '../shared/ipc'

export interface Topbar {
  update(snap: TabsSnapshot): void
}

export function initTopbar(): Topbar {
  const back = document.getElementById('nav-back') as HTMLButtonElement
  const forward = document.getElementById('nav-forward') as HTMLButtonElement
  const reload = document.getElementById('nav-reload') as HTMLButtonElement
  const urlbar = document.getElementById('urlbar') as HTMLInputElement
  let activeId: string | null = null

  back.addEventListener('click', () => activeId && window.synapse.tabs.back(activeId))
  forward.addEventListener('click', () => activeId && window.synapse.tabs.forward(activeId))
  reload.addEventListener('click', () => activeId && window.synapse.tabs.reload(activeId))

  urlbar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && activeId && urlbar.value.trim()) {
      window.synapse.tabs.navigate(activeId, urlbar.value)
      urlbar.blur()
    }
  })

  window.synapse.ui.onFocusUrlBar(() => {
    urlbar.focus()
    urlbar.select()
  })

  return {
    update(snap) {
      activeId = snap.activeId
      const tab = activeId ? snap.tabs[activeId] : null
      back.disabled = !tab?.canGoBack
      forward.disabled = !tab?.canGoForward
      reload.disabled = !tab
      if (document.activeElement !== urlbar) urlbar.value = tab?.url ?? ''
    },
  }
}
