import { describe, expect, it } from 'vitest'
import { routeProfile, sanitizeRules } from '../src/shared/profile-routing'
import type { ProfileRule } from '../src/shared/profile-routing'

const rule = (pattern: string, profile: 'default' | 'work', id = pattern): ProfileRule => ({
  id,
  pattern,
  profile,
})

describe('routeProfile', () => {
  it('matches a case-insensitive substring of the url', () => {
    const rules = [rule('GitHub.com', 'work')]
    expect(routeProfile(rules, 'https://github.com/dep/synapse')).toBe('work')
    expect(routeProfile(rules, 'https://example.test/')).toBeNull()
  })

  it('first matching rule wins', () => {
    const rules = [rule('github.com/dep', 'default'), rule('github.com', 'work')]
    expect(routeProfile(rules, 'https://github.com/dep/x')).toBe('default')
    expect(routeProfile(rules, 'https://github.com/other')).toBe('work')
  })

  it('skips empty and whitespace-only patterns', () => {
    const rules = [rule('', 'work'), rule('   ', 'work'), rule('a.test', 'default')]
    expect(routeProfile(rules, 'https://a.test/')).toBe('default')
    expect(routeProfile(rules, 'https://b.test/')).toBeNull()
  })

  it('returns null with no rules', () => {
    expect(routeProfile([], 'https://a.test/')).toBeNull()
  })
})

describe('sanitizeRules', () => {
  it('keeps well-formed rules and coerces unknown profiles to default', () => {
    expect(
      sanitizeRules([
        { id: '1', pattern: 'a.test', profile: 'work' },
        { id: '2', pattern: 'b.test', profile: 'nonsense' },
      ]),
    ).toEqual([
      { id: '1', pattern: 'a.test', profile: 'work' },
      { id: '2', pattern: 'b.test', profile: 'default' },
    ])
  })

  it('drops malformed entries and non-arrays', () => {
    expect(sanitizeRules('junk')).toEqual([])
    expect(sanitizeRules([null, 42, { id: 1, pattern: 'x' }, { id: 'ok' }])).toEqual([])
  })
})
