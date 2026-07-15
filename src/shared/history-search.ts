import type { Bookmark, HistoryEntry, Suggestion } from './ipc'
import { FULL_URL_RE } from './url-classifier'

export type SuggestionBookmark = Pick<Bookmark, 'url' | 'title' | 'createdAt'> & {
  favicon?: string | null
}

const DAY = 86_400_000
// Firefox-style frecency buckets: a visit's weight decays with age
const BUCKETS: [maxAgeDays: number, weight: number][] = [
  [4, 100],
  [14, 70],
  [31, 50],
  [90, 30],
]
const OLD_WEIGHT = 10
const BOOKMARK_BONUS = 150

interface Candidate {
  url: string
  stripped: string
  title: string
  bookmarkTitle: string | null
  favicon: string | null
  isBookmark: boolean
  visits: number[]
  lastVisit: number
}

export function stripUrl(url: string): string {
  return url.replace(FULL_URL_RE, '').replace(/^www\./i, '')
}

// One tokenizer for matching (scorer) and highlighting (renderer): the query
// is scheme/www-stripped like the haystack, so "https://fee" still finds
// feedback.* rows
export function queryTokens(query: string): string[] {
  const q = stripUrl(query.trim().toLowerCase())
  return q ? q.split(/\s+/) : []
}

// candidates match and autocomplete against this form; host-only URLs gain a
// trailing slash so "a.com/" typed by the user still matches https://a.com
function strippedForMatch(url: string): string {
  const s = stripUrl(url)
  return s.includes('/') ? s : `${s}/`
}

export function visitWeight(age: number): number {
  for (const [days, weight] of BUCKETS) if (age <= days * DAY) return weight
  return OLD_WEIGHT
}

function hasBoundaryMatch(hay: string, token: string): boolean {
  for (let i = hay.indexOf(token); i !== -1; i = hay.indexOf(token, i + 1)) {
    if (i === 0 || !/[a-z0-9]/.test(hay[i - 1])) return true
  }
  return false
}

// 2 = every token starts at a word boundary, 1 = every token a substring, 0 = miss
function matchTier(tokens: string[], hay: string): number {
  let tier = 2
  for (const token of tokens) {
    if (!hay.includes(token)) return 0
    if (!hasBoundaryMatch(hay, token)) tier = 1
  }
  return tier
}

// Candidates are unique history URLs (all visit timestamps collected — the
// frecency signal) plus never-visited bookmarks. Rank: match tier, then
// frecency + bookmark bonus, then last visit. A single-token query that
// prefixes a candidate's scheme-less URL yields an inline autocomplete,
// promoted to rank 1.
export function searchSuggestions(
  entries: HistoryEntry[],
  bookmarks: SuggestionBookmark[],
  query: string,
  now: number,
  limit = 6,
): Suggestion[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return []

  const byUrl = new Map<string, Candidate>()
  for (const entry of entries) {
    const c = byUrl.get(entry.url)
    if (c) {
      // entries are newest-first, so the first occurrence already holds the freshest title
      c.visits.push(entry.visitedAt)
      c.lastVisit = Math.max(c.lastVisit, entry.visitedAt)
    } else {
      byUrl.set(entry.url, {
        url: entry.url,
        stripped: strippedForMatch(entry.url),
        title: entry.title,
        bookmarkTitle: null,
        favicon: null,
        isBookmark: false,
        visits: [entry.visitedAt],
        lastVisit: entry.visitedAt,
      })
    }
  }
  for (const b of bookmarks) {
    const c = byUrl.get(b.url)
    if (c) {
      // a visited bookmark stays findable by its user-chosen name, not just
      // the page title its history entries carry
      c.bookmarkTitle = b.title
      c.isBookmark = true
      c.favicon = b.favicon ?? null
    } else {
      byUrl.set(b.url, {
        url: b.url,
        stripped: strippedForMatch(b.url),
        title: b.title,
        bookmarkTitle: b.title,
        favicon: b.favicon ?? null,
        isBookmark: true,
        visits: [],
        lastVisit: b.createdAt,
      })
    }
  }

  const scored: { c: Candidate; tier: number; score: number }[] = []
  for (const c of byUrl.values()) {
    const hay = `${c.title} ${c.bookmarkTitle ?? ''} ${c.stripped}`.toLowerCase()
    const tier = matchTier(tokens, hay)
    if (tier === 0) continue
    const frecency = c.visits.reduce((sum, v) => sum + visitWeight(now - v), 0)
    scored.push({ c, tier, score: frecency + (c.isBookmark ? BOOKMARK_BONUS : 0) })
  }
  scored.sort((a, b) => b.tier - a.tier || b.score - a.score || b.c.lastVisit - a.c.lastVisit)

  let results = scored.slice(0, limit)
  let autocomplete: string | null = null
  if (tokens.length === 1) {
    const q = tokens[0]
    const match = scored.find((s) => s.c.stripped.toLowerCase().startsWith(q))
    if (match) {
      const stripped = match.c.stripped
      const hostEnd = stripped.indexOf('/') // strippedForMatch guarantees a slash
      autocomplete = q.length <= hostEnd ? stripped.slice(0, hostEnd + 1) : stripped
      results = [match, ...results.filter((s) => s !== match)].slice(0, limit)
    }
  }

  return results.map(({ c }, i) => ({
    url: c.url,
    title: c.title,
    favicon: c.favicon,
    isBookmark: c.isBookmark,
    autocomplete: i === 0 ? autocomplete : null,
  }))
}
