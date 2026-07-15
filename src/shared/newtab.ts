import { queryTokens, stripUrl, visitWeight } from './history-search'
import type { HistoryEntry, TopSite } from './ipc'

// a view that never had loadURL called reports '', an explicit blank load
// reports 'about:blank'; both mean "show the new-tab page"
export function isBlankUrl(url: string): boolean {
  return url === '' || url === 'about:blank'
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

// rank hosts by frecency-weighted visit totals; a host's tile opens its
// most-visited URL (ties → most recently visited)
export function topSitesFrom(entries: HistoryEntry[], now: number, limit = 10): TopSite[] {
  interface HostAgg {
    score: number
    urls: Map<string, { count: number; last: number }>
  }
  const hosts = new Map<string, HostAgg>()
  for (const entry of entries) {
    const host = hostOf(entry.url)
    if (!host) continue
    let agg = hosts.get(host)
    if (!agg) {
      agg = { score: 0, urls: new Map() }
      hosts.set(host, agg)
    }
    agg.score += visitWeight(now - entry.visitedAt)
    const u = agg.urls.get(entry.url) ?? { count: 0, last: 0 }
    u.count += 1
    u.last = Math.max(u.last, entry.visitedAt)
    agg.urls.set(entry.url, u)
  }
  return [...hosts.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([host, agg]) => {
      const [url] = [...agg.urls.entries()].sort(
        (a, b) => b[1].count - a[1].count || b[1].last - a[1].last,
      )[0]
      return { host, url }
    })
}

// newest-first scan keeps the first occurrence per title; untitled entries
// dedupe by URL instead
export function dedupeByTitle(entries: HistoryEntry[]): HistoryEntry[] {
  const seen = new Set<string>()
  const out: HistoryEntry[] = []
  for (const entry of entries) {
    const key = entry.title ? `t:${entry.title}` : `u:${entry.url}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

// local-midnight day boundaries; the renderer streams rows and inserts a
// header whenever this label changes
export function dayLabel(visitedAt: number, now: number): string {
  const startOfDay = (t: number) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime()
  const day = startOfDay(visitedAt)
  const today = startOfDay(now)
  if (day === today) return 'Today'
  if (day === startOfDay(today - 1)) return 'Yesterday'
  return new Date(day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
}

// every token must appear in title or scheme/www-stripped url (same
// normalization the urlbar suggestions use)
export function filterEntries(entries: HistoryEntry[], query: string): HistoryEntry[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return entries
  return entries.filter((entry) => {
    const hay = `${entry.title} ${stripUrl(entry.url)}`.toLowerCase()
    return tokens.every((t) => hay.includes(t))
  })
}

// WMO weather interpretation codes (Open-Meteo `weathercode`)
export function weatherGlyph(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code === 45 || code === 48) return '🌫️'
  if (code >= 51 && code <= 57) return '🌦️'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return '🌧️'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '🌨️'
  if (code >= 95) return '⛈️'
  return '🌡️'
}

export function formatTemp(tempC: number, useFahrenheit: boolean): string {
  const t = useFahrenheit ? (tempC * 9) / 5 + 32 : tempC
  return `${Math.round(t)}°`
}
