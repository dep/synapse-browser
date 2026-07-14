import { describe, expect, it } from 'vitest'
import { searchSuggestions } from '../src/shared/history-search'
import type { HistoryEntry, Suggestion } from '../src/shared/ipc'

const DAY = 86_400_000
const NOW = 1_000 * DAY // fixed clock, larger than any visit age used below

const e = (url: string, title: string, visitedAt = NOW - DAY): HistoryEntry => ({
  url,
  title,
  visitedAt,
})
const bm = (url: string, title: string, favicon: string | null = null) => ({
  url,
  title,
  createdAt: NOW - DAY,
  favicon,
})
const urls = (results: Suggestion[]): string[] => results.map((s) => s.url)

describe('token matching', () => {
  it('requires every token to match (AND)', () => {
    const entries = [e('https://a.com', 'Alpha Site'), e('https://b.com', 'Beta Site')]
    expect(urls(searchSuggestions(entries, [], 'alpha site', NOW))).toEqual(['https://a.com'])
    expect(searchSuggestions(entries, [], 'alpha beta', NOW)).toEqual([])
  })

  it('matches tokens across title and url together — "play Daily" regression', () => {
    const entries = [
      e('https://play.google.com/books', 'My Daily Briefing'),
      e('https://example.com/other', 'Some Daily Thing'),
    ]
    expect(urls(searchSuggestions(entries, [], 'play Daily', NOW))).toEqual([
      'https://play.google.com/books',
    ])
  })

  it('is case-insensitive', () => {
    const entries = [e('https://a.com', 'Alpha')]
    expect(searchSuggestions(entries, [], 'ALPHA', NOW)).toHaveLength(1)
  })

  it('ranks word-boundary matches above mid-string matches', () => {
    const entries = [
      e('https://concatenate.com', 'String utils'), // 'cat' mid-word
      e('https://cat-pictures.com', 'Cats'), // 'cat' at a boundary
    ]
    expect(urls(searchSuggestions(entries, [], 'cat', NOW))).toEqual([
      'https://cat-pictures.com',
      'https://concatenate.com',
    ])
  })

  it('does not match char subsequences', () => {
    const entries = [e('https://sub-sequence.com', 'x grep y')]
    expect(searchSuggestions(entries, [], 'gp', NOW)).toEqual([])
  })

  it('matches when the query includes the scheme or www.', () => {
    const entries = [e('https://feedback.limitless.ai/', 'Limitless')]
    expect(searchSuggestions(entries, [], 'https://feed', NOW)).toHaveLength(1)
    expect(searchSuggestions(entries, [], 'WWW.feedback', NOW)).toHaveLength(1)
    expect(searchSuggestions(entries, [], 'https://', NOW)).toEqual([])
  })

  it('returns [] for empty or whitespace query', () => {
    expect(searchSuggestions([e('https://a.com', 'A')], [], '', NOW)).toEqual([])
    expect(searchSuggestions([e('https://a.com', 'A')], [], '  ', NOW)).toEqual([])
  })
})

describe('frecency ranking', () => {
  it('a recent visit outweighs many ancient visits', () => {
    const entries = [
      e('https://old.com/page', 'Old', NOW - 200 * DAY),
      e('https://old.com/page', 'Old', NOW - 201 * DAY),
      e('https://old.com/page', 'Old', NOW - 202 * DAY),
      e('https://old.com/page', 'Old', NOW - 203 * DAY),
      e('https://fresh.com/page', 'Fresh', NOW - DAY),
    ]
    // old: 4 visits x 10 = 40; fresh: 1 visit x 100
    expect(urls(searchSuggestions(entries, [], 'page', NOW))[0]).toBe('https://fresh.com/page')
  })

  it('more visits win at equal recency', () => {
    const entries = [
      e('https://rare.com/page', 'Rare'),
      e('https://often.com/page', 'Often'),
      e('https://often.com/page', 'Often'),
    ]
    expect(urls(searchSuggestions(entries, [], 'page', NOW))).toEqual([
      'https://often.com/page',
      'https://rare.com/page',
    ])
  })

  it('bookmark bonus beats a modest visit edge', () => {
    // both old: kept = 10 + 150; busy = 3 x 10
    const entries = [
      e('https://busy.com/page', 'Busy', NOW - 100 * DAY),
      e('https://busy.com/page', 'Busy', NOW - 101 * DAY),
      e('https://busy.com/page', 'Busy', NOW - 102 * DAY),
      e('https://kept.com/page', 'Kept', NOW - 100 * DAY),
    ]
    expect(
      urls(searchSuggestions(entries, [bm('https://kept.com/page', 'Kept')], 'page', NOW)),
    ).toEqual(['https://kept.com/page', 'https://busy.com/page'])
  })

  it('a heavily-used site outranks a never-visited bookmark', () => {
    // daily: 2 x 100 = 200 > bookmark-only 150
    const entries = [
      e('https://daily.com/page', 'Daily', NOW - DAY),
      e('https://daily.com/page', 'Daily', NOW - 2 * DAY),
    ]
    expect(
      urls(searchSuggestions(entries, [bm('https://saved.com/page', 'Saved page')], 'page', NOW)),
    ).toEqual(['https://daily.com/page', 'https://saved.com/page'])
  })

  it('dedupes by url; newest title wins; all visits count', () => {
    const entries = [
      e('https://a.com', 'Newest', NOW - DAY),
      e('https://a.com', 'Older', NOW - 2 * DAY),
    ]
    const results = searchSuggestions(entries, [], 'a.com', NOW)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Newest')
  })

  it('limits to 6 by default', () => {
    const entries = Array.from({ length: 10 }, (_, i) => e(`https://site${i}.com`, `Site ${i}`))
    expect(searchSuggestions(entries, [], 'site', NOW)).toHaveLength(6)
  })
})

describe('bookmarks', () => {
  it('surfaces never-visited bookmarks by bookmark title', () => {
    const results = searchSuggestions(
      [],
      [bm('https://docs.example.com', 'Example Docs')],
      'docs',
      NOW,
    )
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://docs.example.com')
    expect(results[0].title).toBe('Example Docs')
    expect(results[0].isBookmark).toBe(true)
  })

  it('a visited bookmark keeps the history title but matches its bookmark title', () => {
    const entries = [e('https://chase.com/login', 'Sign In')]
    const results = searchSuggestions(
      entries,
      [bm('https://chase.com/login', 'Banking')],
      'banking',
      NOW,
    )
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Sign In')
    expect(results[0].isBookmark).toBe(true)
  })

  it('carries the bookmark favicon', () => {
    const results = searchSuggestions(
      [],
      [bm('https://a.com', 'A', 'https://a.com/i.png')],
      'a.com',
      NOW,
    )
    expect(results[0].favicon).toBe('https://a.com/i.png')
  })

  it('plain history rows have favicon null and isBookmark false', () => {
    const results = searchSuggestions([e('https://a.com', 'A')], [], 'a.com', NOW)
    expect(results[0].favicon).toBeNull()
    expect(results[0].isBookmark).toBe(false)
  })
})

describe('inline autocomplete', () => {
  it('offers host completion when typed text is a host prefix', () => {
    const entries = [e('https://feedback.limitless.ai/posts/1', 'Limitless feature requests')]
    const [top] = searchSuggestions(entries, [], 'fe', NOW)
    expect(top.autocomplete).toBe('feedback.limitless.ai/')
  })

  it('ignores scheme and www. for the prefix', () => {
    const entries = [e('https://www.nytimes.com/section/food', 'Food')]
    const [top] = searchSuggestions(entries, [], 'nyt', NOW)
    expect(top.autocomplete).toBe('nytimes.com/')
  })

  it('completes the full url once typing extends into the path', () => {
    const entries = [e('https://a.com/deep/page', 'Deep')]
    const [top] = searchSuggestions(entries, [], 'a.com/de', NOW)
    expect(top.autocomplete).toBe('a.com/deep/page')
  })

  it('promotes the autofill candidate to rank 1 with autocomplete set only there', () => {
    const entries = [
      e('https://news.ycombinator.com', 'Hacker News feed', NOW - DAY),
      e('https://news.ycombinator.com', 'Hacker News feed', NOW - DAY),
      e('https://feedback.limitless.ai/', 'Limitless feature requests', NOW - 100 * DAY),
    ]
    // 'fee' matches the HN title ('feed') with higher frecency, but only prefixes feedback.*
    const results = searchSuggestions(entries, [], 'fee', NOW)
    expect(results[0].url).toBe('https://feedback.limitless.ai/')
    expect(results[0].autocomplete).toBe('feedback.limitless.ai/')
    expect(results.slice(1).every((s) => s.autocomplete === null)).toBe(true)
  })

  it('picks the highest-frecency prefix candidate', () => {
    const entries = [
      e('https://feedly.com', 'Feedly', NOW - 100 * DAY),
      e('https://feedback.limitless.ai/', 'Limitless', NOW - DAY),
    ]
    const [top] = searchSuggestions(entries, [], 'fee', NOW)
    expect(top.autocomplete).toBe('feedback.limitless.ai/')
  })

  it('still offers host completion when the stored url has no trailing slash', () => {
    const entries = [e('https://a.com', 'A')]
    expect(searchSuggestions(entries, [], 'a.co', NOW)[0].autocomplete).toBe('a.com/')
    expect(searchSuggestions(entries, [], 'a.com/', NOW)[0].autocomplete).toBe('a.com/')
  })

  it('keeps the candidate url casing in the completion', () => {
    const entries = [e('https://github.com/User/Repo', 'Repo')]
    const [top] = searchSuggestions(entries, [], 'github.com/us', NOW)
    expect(top.autocomplete).toBe('github.com/User/Repo')
  })

  it('never offers autocomplete for multi-word queries', () => {
    const entries = [e('https://play.google.com/books', 'My Daily Briefing')]
    const [top] = searchSuggestions(entries, [], 'play Daily', NOW)
    expect(top.autocomplete).toBeNull()
  })

  it('offers nothing when no result prefixes the typed text', () => {
    const entries = [e('https://a.com', 'Feedback hub')]
    const [top] = searchSuggestions(entries, [], 'fee', NOW)
    expect(top.autocomplete).toBeNull()
  })
})
