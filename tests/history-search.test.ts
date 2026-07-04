import { describe, expect, it } from 'vitest'
import { searchHistory } from '../src/shared/history-search'
import type { HistoryEntry } from '../src/shared/ipc'

const e = (url: string, title: string): HistoryEntry => ({ url, title, visitedAt: 0 })

describe('searchHistory', () => {
  it('matches substrings in title or url', () => {
    const entries = [e('https://a.com', 'Alpha Site'), e('https://b.com/rust-book', 'Learn')]
    expect(searchHistory(entries, 'alpha').map((x) => x.url)).toEqual(['https://a.com'])
    expect(searchHistory(entries, 'rust').map((x) => x.url)).toEqual(['https://b.com/rust-book'])
  })

  it('ranks substring matches above subsequence matches', () => {
    const entries = [
      e('https://sub-sequence.com', 'x grep y'), // 'gp' only as subsequence
      e('https://gp.com', 'GP direct'), // 'gp' substring
    ]
    expect(searchHistory(entries, 'gp').map((x) => x.url)).toEqual([
      'https://gp.com',
      'https://sub-sequence.com',
    ])
  })

  it('excludes non-matches', () => {
    const entries = [e('https://a.com', 'Alpha')]
    expect(searchHistory(entries, 'zzz')).toEqual([])
  })

  it('dedupes by url keeping the most recent entry', () => {
    const entries = [e('https://a.com', 'Newest'), e('https://a.com', 'Older')]
    const results = searchHistory(entries, 'a.com')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Newest')
  })

  it('limits results to 5 by default, preserving recency order', () => {
    const entries = Array.from({ length: 10 }, (_, i) => e(`https://site${i}.com`, `Site ${i}`))
    const results = searchHistory(entries, 'site')
    expect(results).toHaveLength(5)
    expect(results[0].url).toBe('https://site0.com')
  })

  it('returns [] for empty query', () => {
    expect(searchHistory([e('https://a.com', 'A')], '')).toEqual([])
    expect(searchHistory([e('https://a.com', 'A')], '  ')).toEqual([])
  })
})
