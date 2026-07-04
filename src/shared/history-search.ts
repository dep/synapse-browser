import type { HistoryEntry } from './ipc'

export function searchHistory(entries: HistoryEntry[], query: string, limit = 5): HistoryEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const seen = new Set<string>()
  const scored: { entry: HistoryEntry; score: number }[] = []
  for (const entry of entries) {
    if (seen.has(entry.url)) continue
    seen.add(entry.url)
    const hay = `${entry.title} ${entry.url}`.toLowerCase()
    let score = 0
    if (hay.includes(q)) score = 2
    else if (isSubsequence(q, hay)) score = 1
    if (score > 0) scored.push({ entry, score })
  }
  // Array.prototype.sort is stable: within a score, recency order is preserved.
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.entry)
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0
  for (const ch of hay) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return needle.length === 0
}
