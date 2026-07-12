import { describe, expect, it } from 'vitest'
import { searchSuggestions } from '../src/shared/history-search'
import type { HistoryEntry } from '../src/shared/ipc'

const e = (url: string, title: string): HistoryEntry => ({ url, title, visitedAt: 0 })
const bm = (url: string, title: string) => ({ url, title, createdAt: 0 })

describe('searchSuggestions over history', () => {
  it('matches substrings in title or url', () => {
    const entries = [e('https://a.com', 'Alpha Site'), e('https://b.com/rust-book', 'Learn')]
    expect(searchSuggestions(entries, [], 'alpha').map((x) => x.url)).toEqual(['https://a.com'])
    expect(searchSuggestions(entries, [], 'rust').map((x) => x.url)).toEqual([
      'https://b.com/rust-book',
    ])
  })

  it('ranks substring matches above subsequence matches', () => {
    const entries = [
      e('https://sub-sequence.com', 'x grep y'), // 'gp' only as subsequence
      e('https://gp.com', 'GP direct'), // 'gp' substring
    ]
    expect(searchSuggestions(entries, [], 'gp').map((x) => x.url)).toEqual([
      'https://gp.com',
      'https://sub-sequence.com',
    ])
  })

  it('excludes non-matches', () => {
    const entries = [e('https://a.com', 'Alpha')]
    expect(searchSuggestions(entries, [], 'zzz')).toEqual([])
  })

  it('dedupes by url keeping the most recent entry', () => {
    const entries = [e('https://a.com', 'Newest'), e('https://a.com', 'Older')]
    const results = searchSuggestions(entries, [], 'a.com')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Newest')
  })

  it('limits results to 5 by default, preserving recency order', () => {
    const entries = Array.from({ length: 10 }, (_, i) => e(`https://site${i}.com`, `Site ${i}`))
    const results = searchSuggestions(entries, [], 'site')
    expect(results).toHaveLength(5)
    expect(results[0].url).toBe('https://site0.com')
  })

  it('returns [] for empty query', () => {
    expect(searchSuggestions([e('https://a.com', 'A')], [], '')).toEqual([])
    expect(searchSuggestions([e('https://a.com', 'A')], [], '  ')).toEqual([])
  })
})

describe('searchSuggestions boosts', () => {
  it('ranks bookmarked urls above plain history at equal match quality', () => {
    const entries = [e('https://plain.com/site', 'Site A'), e('https://marked.com/site', 'Site B')]
    const urls = searchSuggestions(entries, [bm('https://marked.com/site', 'Site B')], 'site').map(
      (x) => x.url,
    )
    expect(urls).toEqual(['https://marked.com/site', 'https://plain.com/site'])
  })

  it('ranks more-visited urls higher within a tier', () => {
    // one visit to often.com per entry occurrence; rare.com is more recent
    const entries = [
      e('https://rare.com/page', 'Rare'),
      e('https://often.com/page', 'Often'),
      e('https://other.com', 'Filler'),
      e('https://often.com/page', 'Often'),
      e('https://elsewhere.com', 'Filler'),
      e('https://often.com/page', 'Often'),
    ]
    const urls = searchSuggestions(entries, [], 'page').map((x) => x.url)
    expect(urls).toEqual(['https://often.com/page', 'https://rare.com/page'])
  })

  it('match quality still beats bookmark and frequency boosts', () => {
    // 'gp' is a substring for gp.com, only a subsequence for the boosted ones
    const entries = [
      e('https://grep.com', 'x grep y'),
      e('https://grep.com', 'x grep y'),
      e('https://grep.com', 'x grep y'),
      e('https://gp.com', 'GP direct'),
    ]
    const urls = searchSuggestions(entries, [bm('https://grep.com', 'x grep y')], 'gp').map(
      (x) => x.url,
    )
    expect(urls).toEqual(['https://gp.com', 'https://grep.com'])
  })

  it('surfaces bookmarks that were never visited', () => {
    const results = searchSuggestions([], [bm('https://docs.example.com', 'Example Docs')], 'docs')
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://docs.example.com')
    expect(results[0].title).toBe('Example Docs')
  })

  it('merges a visited bookmark into one suggestion with the history title', () => {
    const entries = [e('https://a.com', 'Fresh page title')]
    const results = searchSuggestions(
      entries,
      [bm('https://a.com', 'Stale bookmark title')],
      'a.com',
    )
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Fresh page title')
  })

  it('a visited bookmark still matches on its own bookmark title', () => {
    const entries = [e('https://chase.com/login', 'Sign In')]
    const results = searchSuggestions(entries, [bm('https://chase.com/login', 'Banking')], 'banking')
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://chase.com/login')
  })

  it('bookmark beats a higher visit count', () => {
    const entries = [
      e('https://busy.com/page', 'Busy'),
      e('https://kept.com/page', 'Kept'),
      e('https://busy.com/page', 'Busy'),
    ]
    const urls = searchSuggestions(entries, [bm('https://kept.com/page', 'Kept')], 'page').map(
      (x) => x.url,
    )
    expect(urls).toEqual(['https://kept.com/page', 'https://busy.com/page'])
  })
})
