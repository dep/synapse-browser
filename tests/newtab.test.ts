import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../src/shared/ipc'
import {
  dayLabel,
  dedupeByTitle,
  filterEntries,
  formatTemp,
  hostOf,
  isBlankUrl,
  topSitesFrom,
  weatherGlyph,
} from '../src/shared/newtab'

const DAY = 86_400_000
// local noon anchor keeps day-boundary math away from timezone edges
const NOON = new Date(2026, 6, 15, 12, 0, 0).getTime()

const e = (url: string, title: string, visitedAt: number): HistoryEntry => ({
  url,
  title,
  visitedAt,
})

describe('isBlankUrl', () => {
  it('treats empty and about:blank as blank', () => {
    expect(isBlankUrl('')).toBe(true)
    expect(isBlankUrl('about:blank')).toBe(true)
    expect(isBlankUrl('https://a.com')).toBe(false)
  })
})

describe('hostOf', () => {
  it('extracts the host including port', () => {
    expect(hostOf('https://a.com/x/y')).toBe('a.com')
    expect(hostOf('http://localhost:3000/p')).toBe('localhost:3000')
  })
  it('returns null for unparseable urls', () => {
    expect(hostOf('not a url')).toBe(null)
  })
})

describe('topSitesFrom', () => {
  it('ranks hosts by frecency-weighted visit totals', () => {
    const entries = [
      e('https://a.com/', 'A', NOON - 1 * DAY),
      e('https://a.com/', 'A', NOON - 2 * DAY),
      e('https://b.com/', 'B', NOON - 1 * DAY),
    ]
    const sites = topSitesFrom(entries, NOON)
    expect(sites.map((s) => s.host)).toEqual(['a.com', 'b.com'])
  })

  it('weights recent visits above many ancient ones', () => {
    const entries = [
      // 3 visits ~200 days old (weight 10 each = 30)
      e('https://old.com/', 'Old', NOON - 200 * DAY),
      e('https://old.com/', 'Old', NOON - 201 * DAY),
      e('https://old.com/', 'Old', NOON - 202 * DAY),
      // 1 visit today (weight 100)
      e('https://fresh.com/', 'Fresh', NOON - 1000),
    ]
    expect(topSitesFrom(entries, NOON)[0].host).toBe('fresh.com')
  })

  it("picks the host's most-visited url, ties broken by recency", () => {
    const entries = [
      e('https://a.com/hot', 'Hot', NOON - 1 * DAY),
      e('https://a.com/hot', 'Hot', NOON - 2 * DAY),
      e('https://a.com/cold', 'Cold', NOON - 3 * DAY),
      e('https://b.com/new', 'New', NOON - 1 * DAY),
      e('https://b.com/older', 'Older', NOON - 2 * DAY),
    ]
    const sites = topSitesFrom(entries, NOON)
    expect(sites.find((s) => s.host === 'a.com')?.url).toBe('https://a.com/hot')
    expect(sites.find((s) => s.host === 'b.com')?.url).toBe('https://b.com/new')
  })

  it('caps at the limit and skips unparseable urls', () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      e(`https://site${i}.com/`, `S${i}`, NOON - i * 1000),
    )
    expect(topSitesFrom(entries, NOON).length).toBe(10)
    expect(topSitesFrom([e('nonsense', 'X', NOON)], NOON)).toEqual([])
  })
})

describe('dedupeByTitle', () => {
  it('keeps only the first (newest) entry per title', () => {
    const entries = [
      e('https://a.com/1', 'Same Title', NOON),
      e('https://a.com/2', 'Same Title', NOON - 1000),
      e('https://a.com/3', 'Other', NOON - 2000),
    ]
    expect(dedupeByTitle(entries).map((x) => x.url)).toEqual([
      'https://a.com/1',
      'https://a.com/3',
    ])
  })

  it('dedupes untitled entries by url instead', () => {
    const entries = [
      e('https://a.com/', '', NOON),
      e('https://a.com/', '', NOON - 1000),
      e('https://b.com/', '', NOON - 2000),
    ]
    expect(dedupeByTitle(entries).map((x) => x.url)).toEqual([
      'https://a.com/',
      'https://b.com/',
    ])
  })
})

describe('dayLabel', () => {
  it('labels today and yesterday', () => {
    expect(dayLabel(NOON - 1000, NOON)).toBe('Today')
    expect(dayLabel(NOON - DAY, NOON)).toBe('Yesterday')
  })
  it('labels older days with a dated label', () => {
    const label = dayLabel(NOON - 5 * DAY, NOON)
    expect(label).not.toBe('Today')
    expect(label).not.toBe('Yesterday')
    expect(label).toMatch(/\d/)
  })
})

describe('filterEntries', () => {
  const entries = [
    e('https://github.com/foo', 'GitHub - foo repo', NOON),
    e('https://news.ycombinator.com/', 'Hacker News', NOON - 1000),
  ]
  it('matches tokens against the title', () => {
    expect(filterEntries(entries, 'hacker').map((x) => x.url)).toEqual([
      'https://news.ycombinator.com/',
    ])
  })
  it('matches tokens against the scheme-stripped url', () => {
    expect(filterEntries(entries, 'github.com/foo').length).toBe(1)
  })
  it('requires every token to match', () => {
    expect(filterEntries(entries, 'github news').length).toBe(0)
    expect(filterEntries(entries, 'github repo').length).toBe(1)
  })
  it('returns everything for an empty query', () => {
    expect(filterEntries(entries, '  ').length).toBe(2)
  })
})

describe('weatherGlyph', () => {
  it('maps WMO weather codes to glyphs', () => {
    expect(weatherGlyph(0)).toBe('☀️')
    expect(weatherGlyph(2)).toBe('🌤️')
    expect(weatherGlyph(3)).toBe('☁️')
    expect(weatherGlyph(45)).toBe('🌫️')
    expect(weatherGlyph(53)).toBe('🌦️')
    expect(weatherGlyph(63)).toBe('🌧️')
    expect(weatherGlyph(81)).toBe('🌧️')
    expect(weatherGlyph(73)).toBe('🌨️')
    expect(weatherGlyph(86)).toBe('🌨️')
    expect(weatherGlyph(95)).toBe('⛈️')
  })
})

describe('formatTemp', () => {
  it('rounds celsius and converts to fahrenheit', () => {
    expect(formatTemp(20.4, false)).toBe('20°')
    expect(formatTemp(20, true)).toBe('68°')
  })
})
