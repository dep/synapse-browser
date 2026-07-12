import type { Bookmark, HistoryEntry } from './ipc'

export type SuggestionBookmark = Pick<Bookmark, 'url' | 'title' | 'createdAt'>

interface Candidate {
  entry: HistoryEntry
  visits: number
  bookmarkTitle: string | null
}

// Candidates are unique history URLs (visits = occurrence count in the
// retained window; the store keeps one entry per visit) plus never-visited
// bookmarks. Rank: match quality, then bookmarked, then visit count; ties keep
// insertion order (history newest-first, bookmark-only last) via stable sort.
export function searchSuggestions(
  entries: HistoryEntry[],
  bookmarks: SuggestionBookmark[],
  query: string,
  limit = 5,
): HistoryEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const byUrl = new Map<string, Candidate>()
  for (const entry of entries) {
    const seen = byUrl.get(entry.url)
    if (seen) seen.visits++
    else byUrl.set(entry.url, { entry, visits: 1, bookmarkTitle: null })
  }
  for (const b of bookmarks) {
    const seen = byUrl.get(b.url)
    if (seen) seen.bookmarkTitle = b.title
    else
      byUrl.set(b.url, {
        entry: { url: b.url, title: b.title, visitedAt: b.createdAt },
        visits: 0,
        bookmarkTitle: b.title,
      })
  }

  const scored: { c: Candidate; match: number }[] = []
  for (const c of byUrl.values()) {
    // a visited bookmark stays findable by its user-chosen name, not just
    // the page title its history entries carry
    const hay = `${c.entry.title} ${c.bookmarkTitle ?? ''} ${c.entry.url}`.toLowerCase()
    const match = hay.includes(q) ? 2 : isSubsequence(q, hay) ? 1 : 0
    if (match > 0) scored.push({ c, match })
  }
  scored.sort(
    (a, b) =>
      b.match - a.match ||
      Number(b.c.bookmarkTitle !== null) - Number(a.c.bookmarkTitle !== null) ||
      b.c.visits - a.c.visits,
  )
  return scored.slice(0, limit).map((s) => s.c.entry)
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0
  for (const ch of hay) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return needle.length === 0
}
