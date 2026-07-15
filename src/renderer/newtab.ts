import type { HistoryEntry, NewTabData, TabsSnapshot, WeatherInfo } from '../shared/ipc'
import {
  dayLabel,
  dedupeByTitle,
  filterEntries,
  formatTemp,
  hostOf,
  isBlankUrl,
  weatherGlyph,
} from '../shared/newtab'

const PAGE_SIZE = 100

export interface NewTabController {
  update(snap: TabsSnapshot, settingsOpen: boolean): void
}

export function initNewTab(el: HTMLElement): NewTabController {
  const well = document.createElement('div')
  well.className = 'newtab-well'
  const column = document.createElement('div')
  column.className = 'newtab-column'
  const clockEl = document.createElement('div')
  clockEl.className = 'newtab-clock'
  const dateEl = document.createElement('div')
  dateEl.className = 'newtab-date'
  const weatherEl = document.createElement('div')
  weatherEl.className = 'newtab-weather'
  weatherEl.hidden = true
  const tilesEl = document.createElement('div')
  tilesEl.className = 'newtab-tiles'
  const searchEl = document.createElement('input')
  searchEl.className = 'newtab-search'
  searchEl.type = 'text'
  searchEl.placeholder = 'Search history…'
  searchEl.spellcheck = false
  const listEl = document.createElement('div')
  listEl.className = 'newtab-list'
  const sentinel = document.createElement('div')
  sentinel.className = 'newtab-sentinel'
  column.append(clockEl, dateEl, weatherEl, tilesEl, searchEl, listEl, sentinel)
  well.append(column)
  el.append(well)

  let visible = false
  let activeId: string | null = null
  let data: NewTabData | null = null
  let deduped: HistoryEntry[] = []
  let rendered = 0
  let lastLabel = ''
  let loadGen = 0
  let listNow = Date.now()
  let shownTabId: string | null = null
  let timer: ReturnType<typeof setInterval> | undefined

  const navigate = (url: string): void => {
    if (activeId) window.synapse.tabs.navigate(activeId, url)
  }

  const tickClock = (): void => {
    const now = new Date()
    clockEl.textContent = now.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
  }

  const iconFor = (url: string): HTMLElement => {
    const host = hostOf(url)
    const fav = host ? data?.favicons[host] : undefined
    if (fav) {
      const img = document.createElement('img')
      img.className = 'newtab-icon'
      img.onerror = () => (img.style.visibility = 'hidden')
      img.src = fav
      return img
    }
    const mono = document.createElement('div')
    mono.className = 'newtab-icon newtab-monogram'
    const name = host?.replace(/^www\./, '') ?? '?'
    mono.textContent = name[0]!.toUpperCase()
    return mono
  }

  const renderWeather = (w: WeatherInfo | null): void => {
    weatherEl.hidden = !w
    if (w) {
      weatherEl.textContent =
        `${weatherGlyph(w.code)} ${formatTemp(w.tempC, w.useFahrenheit)} ${w.city}`.trim()
    }
  }

  const renderTiles = (): void => {
    tilesEl.innerHTML = ''
    const sites = data?.topSites ?? []
    tilesEl.hidden = sites.length === 0
    for (const site of sites) {
      const tile = document.createElement('button')
      tile.className = 'newtab-tile'
      tile.title = site.url
      const label = document.createElement('span')
      label.className = 'newtab-tile-label'
      label.textContent = site.host.replace(/^www\./, '')
      tile.append(iconFor(site.url), label)
      tile.addEventListener('click', () => navigate(site.url))
      tilesEl.append(tile)
    }
  }

  const currentList = (): HistoryEntry[] =>
    searchEl.value.trim() ? filterEntries(deduped, searchEl.value) : deduped

  const appendRows = (): void => {
    const list = currentList()
    const searching = !!searchEl.value.trim()
    for (const entry of list.slice(rendered, rendered + PAGE_SIZE)) {
      if (!searching) {
        const label = dayLabel(entry.visitedAt, listNow)
        if (label !== lastLabel) {
          lastLabel = label
          const heading = document.createElement('div')
          heading.className = 'newtab-heading'
          heading.textContent = label
          listEl.append(heading)
        }
      }
      const row = document.createElement('button')
      row.className = 'newtab-row'
      const title = document.createElement('span')
      title.className = 'newtab-row-title'
      title.textContent = entry.title || entry.url
      const host = document.createElement('span')
      host.className = 'newtab-row-host'
      host.textContent = hostOf(entry.url) ?? ''
      const time = document.createElement('span')
      time.className = 'newtab-row-time'
      time.textContent = new Date(entry.visitedAt).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })
      row.append(iconFor(entry.url), title, host, time)
      row.addEventListener('click', () => navigate(entry.url))
      listEl.append(row)
    }
    rendered = Math.min(rendered + PAGE_SIZE, list.length)
    sentinel.hidden = rendered >= list.length
  }

  const resetList = (): void => {
    listEl.innerHTML = ''
    rendered = 0
    lastLabel = ''
    listNow = Date.now()
    searchEl.hidden = deduped.length === 0
    appendRows()
  }

  searchEl.addEventListener('input', resetList)

  // the well is the scroller; when it nears the sentinel, page in more rows
  const io = new IntersectionObserver((es) => {
    if (es.some((x) => x.isIntersecting)) appendRows()
  }, { root: well })
  io.observe(sentinel)

  const load = async (): Promise<void> => {
    const gen = ++loadGen
    const d = await window.synapse.newtab.data()
    if (!visible || gen !== loadGen) return
    data = d
    deduped = dedupeByTitle(data.entries)
    renderTiles()
    resetList()
    renderWeather(data.weather)
    const w = await window.synapse.newtab.weather()
    if (visible && gen === loadGen) renderWeather(w)
  }

  return {
    update(snap: TabsSnapshot, settingsOpen: boolean): void {
      const active = snap.activeId ? snap.tabs[snap.activeId] : undefined
      activeId = snap.activeId
      const show = !settingsOpen && !!active && isBlankUrl(active.url)
      if (show === visible) {
        // a second blank tab must not inherit the previous one's search
        // text, filter, or scroll position
        if (visible && activeId !== shownTabId) {
          shownTabId = activeId
          searchEl.value = ''
          well.scrollTop = 0
          resetList()
        }
        return
      }
      visible = show
      el.hidden = !show
      if (show) {
        shownTabId = activeId
        tickClock()
        timer = setInterval(tickClock, 1000)
        searchEl.value = ''
        well.scrollTop = 0
        void load()
      } else {
        shownTabId = null
        clearInterval(timer)
      }
    },
  }
}
