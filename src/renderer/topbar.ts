import { isHttpUrl } from '../shared/url-classifier'
import type { Suggestion, TabsSnapshot } from '../shared/ipc'
import { ICON_BACK, ICON_FORWARD, ICON_RELOAD, ICON_STOP } from './icons'

export interface Topbar {
  update(snap: TabsSnapshot): void
}

export function shouldSyncUrlbar({
  tabChanged,
  urlbarFocused,
  loadingStarted,
  value,
}: {
  tabChanged: boolean
  urlbarFocused: boolean
  loadingStarted: boolean
  value: string
}): boolean {
  return tabChanged || !urlbarFocused || (loadingStarted && value.trim() === '')
}

export function initTopbar(): Topbar {
  const back = document.getElementById('nav-back') as HTMLButtonElement
  const forward = document.getElementById('nav-forward') as HTMLButtonElement
  const reload = document.getElementById('nav-reload') as HTMLButtonElement
  back.innerHTML = ICON_BACK
  forward.innerHTML = ICON_FORWARD
  reload.innerHTML = ICON_RELOAD
  const star = document.getElementById('star') as HTMLButtonElement
  const pill = document.getElementById('download-pill') as HTMLButtonElement
  let latestDownload: import('../shared/ipc').DownloadInfo | null = null
  const PILL_HIDE_DELAY_MS = 5000
  let pillHideTimer: ReturnType<typeof setTimeout> | null = null

  window.synapse.downloads.onUpdated((list) => {
    latestDownload = list[list.length - 1] ?? null
    renderPill()
  })

  pill.addEventListener('click', () => {
    if (latestDownload?.state === 'completed') window.synapse.downloads.reveal(latestDownload.id)
  })

  function renderPill(): void {
    if (pillHideTimer) clearTimeout(pillHideTimer)
    pillHideTimer = null
    if (!latestDownload) {
      pill.hidden = true
      return
    }
    pill.hidden = false
    const d = latestDownload
    if (d.state === 'progressing') {
      const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0
      pill.textContent = `↓ ${d.filename} ${pct}%`
    } else {
      if (d.state === 'completed') {
        pill.textContent = `✓ ${d.filename}`
        pill.title = 'Show in Finder'
      } else {
        pill.textContent = `✕ ${d.filename}`
        pill.title = 'Download failed'
      }
      // finished chips linger briefly, then get out of the way
      pillHideTimer = setTimeout(() => {
        pill.hidden = true
      }, PILL_HIDE_DELAY_MS)
    }
  }

  const urlbar = document.getElementById('urlbar') as HTMLInputElement
  const urlbarWrap = document.getElementById('urlbar-wrap') as HTMLDivElement
  let activeId: string | null = null
  let activeLoading = false
  let suggestions: Suggestion[] = []
  let selected = -1
  let autoSelected = false // row 0 highlighted by inline autofill, not by the user
  let lastQuery = ''

  // cmd-click opens the target in a new background tab (issue #22)
  const navClick = (offset: -1 | 0 | 1, plain: (id: string) => void) => (e: MouseEvent) => {
    if (!activeId) return
    if (e.metaKey) window.synapse.tabs.openNavInNewTab(activeId, offset)
    else plain(activeId)
  }
  back.addEventListener('click', navClick(-1, (id) => window.synapse.tabs.back(id)))
  forward.addEventListener('click', navClick(1, (id) => window.synapse.tabs.forward(id)))
  reload.addEventListener('click', (e) => {
    if (!activeId) return
    // while loading the button IS the stop button — cmd must not reroute it
    if (activeLoading) window.synapse.tabs.stop(activeId)
    else if (e.metaKey) window.synapse.tabs.openNavInNewTab(activeId, 0)
    else window.synapse.tabs.reload(activeId)
  })
  star.addEventListener('click', () => void window.synapse.bookmarks.toggleActive())

  const extMenuWrap = document.getElementById('ext-menu-wrap') as HTMLDivElement
  const extMenuToggle = document.getElementById('ext-menu-toggle') as HTMLButtonElement
  const extMenu = document.getElementById('ext-menu') as HTMLDivElement

  // the canvas frame's top padding must track the page view's overlay shift,
  // so both are driven from this one origin
  function setOverlay(px: number): void {
    document.getElementById('app')!.style.setProperty('--overlay-shift', `${px}px`)
    window.synapse.ui.setOverlayHeight(px)
  }

  function hideExtMenu(): void {
    extMenu.hidden = true
    setOverlay(0)
  }

  extMenuToggle.addEventListener('click', (e) => {
    e.stopPropagation()
    if (extMenu.hidden) {
      extMenu.hidden = false
      setOverlay(extMenu.offsetHeight + 4)
    } else {
      hideExtMenu()
    }
  })

  document.addEventListener('click', (e) => {
    if (!extMenu.hidden && !extMenuWrap.contains(e.target as Node)) hideExtMenu()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !extMenu.hidden) hideExtMenu()
  })

  // the dropdown is a native overlay view drawn above the page (it could
  // never overlap it from this document); state lives here, rows render there
  function pushSuggestions(): void {
    const r = urlbarWrap.getBoundingClientRect()
    window.synapse.suggestions.update({
      anchor: { x: r.left, y: r.bottom + 4, width: r.width },
      items: suggestions,
      selected,
      query: lastQuery,
    })
  }

  function hideSuggestions(): void {
    suggestions = []
    selected = -1
    autoSelected = false
    pushSuggestions()
  }

  // the overlay can't track layout on its own; re-anchor it when the urlbar
  // re-flows (window resize, fullscreen) while the dropdown is open
  new ResizeObserver(() => {
    if (suggestions.length > 0) pushSuggestions()
  }).observe(urlbarWrap)

  function pick(i: number): void {
    const entry = suggestions[i]
    if (entry && activeId) {
      window.synapse.tabs.navigate(activeId, entry.url)
      urlbar.blur()
    }
    hideSuggestions()
  }

  // pop the highlighted suggestion's URL into the bar, cursor at the end,
  // so the user can start editing it immediately
  function applySelection(): void {
    const value = suggestions[selected].url
    urlbar.value = value
    urlbar.setSelectionRange(value.length, value.length)
  }

  urlbar.addEventListener('input', async (e) => {
    const deletion = e instanceof InputEvent && !!e.inputType?.startsWith('delete')
    const q = urlbar.value.trim()
    if (!q) {
      hideSuggestions()
      return
    }
    const results = await window.synapse.history.search(q)
    if (urlbar.value.trim() !== q || document.activeElement !== urlbar) return // stale response
    suggestions = results
    lastQuery = q
    selected = -1
    autoSelected = false
    const auto = results[0]?.autocomplete
    // inline autofill: complete in place with the remainder selected — but
    // never while deleting, or backspace would fight the user
    if (
      auto &&
      !deletion &&
      urlbar.value === q &&
      auto.toLowerCase().startsWith(q.toLowerCase()) &&
      auto.length > q.length
    ) {
      // take the candidate's own casing wholesale: echoing the typed prefix
      // verbatim would silently lowercase mixed-case path segments
      urlbar.value = auto
      urlbar.setSelectionRange(q.length, urlbar.value.length)
      selected = 0
      autoSelected = true
    }
    pushSuggestions()
  })

  urlbar.addEventListener('blur', () => hideSuggestions())

  // first click selects the whole url; once focused, clicks place the cursor.
  // select() must run on mouseup (with default prevented) because the
  // browser's default mouseup collapses the selection made on focus.
  let selectOnMouseUp = false
  urlbar.addEventListener('mousedown', () => {
    selectOnMouseUp = document.activeElement !== urlbar
  })
  urlbar.addEventListener('mouseup', (e) => {
    if (!selectOnMouseUp) return
    selectOnMouseUp = false
    e.preventDefault()
    urlbar.select()
  })

  urlbar.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault()
      selected = (selected + 1) % suggestions.length
      autoSelected = false
      pushSuggestions()
      applySelection()
    } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault()
      selected = (selected - 1 + suggestions.length) % suggestions.length
      autoSelected = false
      pushSuggestions()
      applySelection()
    } else if (e.key === 'Escape') {
      // an autofilled remainder the user never asked to keep goes away with the dropdown
      const start = urlbar.selectionStart
      if (autoSelected && start !== null && urlbar.selectionEnd === urlbar.value.length)
        urlbar.value = urlbar.value.slice(0, start)
      hideSuggestions()
    } else if (e.key === 'Enter' && activeId && urlbar.value.trim()) {
      const userPicked = selected >= 0 && !autoSelected
      if (e.altKey) {
        window.synapse.tabs.create(userPicked ? suggestions[selected].url : urlbar.value)
        urlbar.blur()
        hideSuggestions()
      } else if (userPicked) {
        pick(selected)
      } else {
        // autofilled text goes through classifyInput in main, so
        // "feedback.limitless.ai/" loads https://feedback.limitless.ai/
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

  // a row was clicked in the overlay; main already navigated
  window.synapse.suggestions.onPicked(() => {
    urlbar.blur()
    hideSuggestions()
  })

  return {
    update(snap) {
      const tabChanged = snap.activeId !== activeId
      if (tabChanged) hideSuggestions()
      activeId = snap.activeId
      const tab = activeId ? snap.tabs[activeId] : null
      back.disabled = !tab?.canGoBack
      forward.disabled = !tab?.canGoForward
      reload.disabled = !tab
      const nowLoading = !!tab?.isLoading
      const loadingStarted = !activeLoading && nowLoading
      if (nowLoading !== activeLoading) {
        // snapshots stream constantly; only reparse the SVG on a real flip
        reload.innerHTML = nowLoading ? ICON_STOP : ICON_RELOAD
        reload.title = nowLoading ? 'Stop' : 'Reload'
      }
      activeLoading = nowLoading
      // A tab switch always rewrites the bar: element focus survives native
      // focus moving to a page view (clicking a page never blurs the chrome
      // document), so the activeElement guard alone would suppress updates
      // forever after any urlbar use. Same-tab snapshots still defer to the
      // guard — activeElement can't distinguish a draft from a stale display,
      // and clobbering a draft is the worse failure. A newly loading page is
      // the exception when the focused bar is blank: reload must restore the
      // current URL rather than preserving an empty stale display.
      if (
        shouldSyncUrlbar({
          tabChanged,
          urlbarFocused: document.activeElement === urlbar,
          loadingStarted,
          value: urlbar.value,
        })
      )
        urlbar.value = tab?.url ?? ''
      const canBookmark = !!tab && !tab.isPinned && (tab.isBookmarked || isHttpUrl(tab.url))
      star.disabled = !canBookmark
      star.textContent = tab?.isBookmarked ? '★' : '☆'
      star.classList.toggle('starred', !!tab?.isBookmarked)
    },
  }
}
