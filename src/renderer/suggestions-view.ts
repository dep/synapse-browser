import './suggestions.css'
import { queryTokens, stripUrl } from '../shared/history-search'
import { ICON_GLOBE } from './icons'

const listEl = document.getElementById('list')!

// wrap each query token's first match in <b>, building text nodes only —
// titles and urls are page-controlled strings
function highlightInto(parent: HTMLElement, text: string, tokens: string[]): void {
  const lower = text.toLowerCase()
  const ranges: [number, number][] = []
  for (const t of tokens) {
    const i = lower.indexOf(t)
    if (i !== -1) ranges.push([i, i + t.length])
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  let pos = 0
  for (const [start, end] of merged) {
    if (start > pos) parent.append(text.slice(pos, start))
    const b = document.createElement('b')
    b.textContent = text.slice(start, end)
    parent.append(b)
    pos = end
  }
  parent.append(text.slice(pos))
}

// arrow keys resend the same rows with a new selected index; moving one CSS
// class avoids rebuilding row DOM and re-fetching favicons per keypress
let lastKey = ''
window.suggestionsOverlay.onUpdate(({ items, selected, query, gen }) => {
  const key = JSON.stringify([items, query])
  if (key === lastKey) {
    listEl.querySelectorAll('.suggestion').forEach((el, i) => {
      el.classList.toggle('selected', i === selected)
      if (i === selected) el.scrollIntoView({ block: 'nearest' })
    })
    window.suggestionsOverlay.height(listEl.offsetHeight, gen)
    return
  }
  lastKey = key
  listEl.innerHTML = ''
  const tokens = queryTokens(query)
  items.forEach((s, i) => {
    const item = document.createElement('div')
    item.className = 'suggestion' + (i === selected ? ' selected' : '')

    const icon = document.createElement('span')
    icon.className = 'suggestion-icon'
    if (s.favicon) {
      const img = document.createElement('img')
      img.onerror = () => {
        icon.innerHTML = ICON_GLOBE
      }
      img.src = s.favicon
      icon.append(img)
    } else {
      icon.innerHTML = ICON_GLOBE
    }

    const text = document.createElement('span')
    text.className = 'suggestion-text'
    const title = document.createElement('span')
    title.className = 'suggestion-title'
    highlightInto(title, s.title, tokens)
    if (s.isBookmark) {
      const star = document.createElement('span')
      star.className = 'suggestion-star'
      star.textContent = '★'
      title.append(star)
    }
    const url = document.createElement('span')
    url.className = 'suggestion-url'
    highlightInto(url, stripUrl(s.url), tokens)
    text.append(title, url)

    item.append(icon, text)
    // mousedown, not click: main should navigate before any focus fallout
    item.addEventListener('mousedown', (e) => {
      e.preventDefault()
      window.suggestionsOverlay.pick(s.url)
    })
    listEl.append(item)
  })
  // main sizes the view to the rendered rows before showing it
  window.suggestionsOverlay.height(listEl.offsetHeight, gen)
})
