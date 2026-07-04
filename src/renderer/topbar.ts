import type { HistoryEntry, TabsSnapshot } from '../shared/ipc'

export interface Topbar {
  update(snap: TabsSnapshot): void
}

export function initTopbar(): Topbar {
  const back = document.getElementById('nav-back') as HTMLButtonElement
  const forward = document.getElementById('nav-forward') as HTMLButtonElement
  const reload = document.getElementById('nav-reload') as HTMLButtonElement
  const star = document.getElementById('star') as HTMLButtonElement
  const pill = document.getElementById('download-pill') as HTMLButtonElement
  let latestDownload: import('../shared/ipc').DownloadInfo | null = null

  window.synapse.downloads.onUpdated((list) => {
    latestDownload = list[list.length - 1] ?? null
    renderPill()
  })

  pill.addEventListener('click', () => {
    if (latestDownload?.state === 'completed') window.synapse.downloads.reveal(latestDownload.id)
  })

  function renderPill(): void {
    if (!latestDownload) {
      pill.hidden = true
      return
    }
    pill.hidden = false
    const d = latestDownload
    if (d.state === 'progressing') {
      const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0
      pill.textContent = `↓ ${d.filename} ${pct}%`
    } else if (d.state === 'completed') {
      pill.textContent = `✓ ${d.filename}`
      pill.title = 'Show in Finder'
    } else {
      pill.textContent = `✕ ${d.filename}`
      pill.title = 'Download failed'
    }
  }

  const urlbar = document.getElementById('urlbar') as HTMLInputElement
  const suggestionsEl = document.getElementById('suggestions') as HTMLDivElement
  let activeId: string | null = null
  let suggestions: HistoryEntry[] = []
  let selected = -1

  back.addEventListener('click', () => activeId && window.synapse.tabs.back(activeId))
  forward.addEventListener('click', () => activeId && window.synapse.tabs.forward(activeId))
  reload.addEventListener('click', () => activeId && window.synapse.tabs.reload(activeId))
  star.addEventListener('click', () => void window.synapse.bookmarks.toggleActive())

  function hideSuggestions(): void {
    suggestions = []
    selected = -1
    suggestionsEl.hidden = true
    suggestionsEl.innerHTML = ''
    window.synapse.ui.setOverlayHeight(0)
  }

  function renderSuggestions(): void {
    suggestionsEl.innerHTML = ''
    suggestions.forEach((entry, i) => {
      const item = document.createElement('div')
      item.className = 'suggestion' + (i === selected ? ' selected' : '')
      const title = document.createElement('span')
      title.className = 'suggestion-title'
      title.textContent = entry.title
      const url = document.createElement('span')
      url.className = 'suggestion-url'
      url.textContent = entry.url
      item.append(title, url)
      // mousedown, not click: it fires before the input's blur hides the dropdown
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        pick(i)
      })
      suggestionsEl.append(item)
    })
    suggestionsEl.hidden = suggestions.length === 0
    window.synapse.ui.setOverlayHeight(suggestionsEl.hidden ? 0 : suggestionsEl.offsetHeight + 4)
  }

  function pick(i: number): void {
    const entry = suggestions[i]
    if (entry && activeId) {
      window.synapse.tabs.navigate(activeId, entry.url)
      urlbar.blur()
    }
    hideSuggestions()
  }

  urlbar.addEventListener('input', async () => {
    const q = urlbar.value.trim()
    if (!q) {
      hideSuggestions()
      return
    }
    const results = await window.synapse.history.search(q)
    if (urlbar.value.trim() !== q) return // stale response; a newer input state owns the UI
    suggestions = results
    selected = -1
    renderSuggestions()
  })

  urlbar.addEventListener('blur', () => hideSuggestions())

  urlbar.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault()
      selected = (selected + 1) % suggestions.length
      renderSuggestions()
    } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault()
      selected = (selected - 1 + suggestions.length) % suggestions.length
      renderSuggestions()
    } else if (e.key === 'Escape') {
      hideSuggestions()
    } else if (e.key === 'Enter' && activeId && urlbar.value.trim()) {
      if (selected >= 0) {
        pick(selected)
      } else {
        window.synapse.tabs.navigate(activeId, urlbar.value)
        urlbar.blur()
        hideSuggestions()
      }
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
      const canBookmark = !!tab && /^https?:\/\//.test(tab.url)
      star.disabled = !canBookmark
      star.textContent = tab?.isBookmarked ? '★' : '☆'
      star.classList.toggle('starred', !!tab?.isBookmarked)
    },
  }
}
