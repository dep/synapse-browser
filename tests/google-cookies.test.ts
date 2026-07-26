import { describe, expect, it } from 'vitest'
import { isGoogleCookie, toElectronCookie, type ChromeCookie } from '../src/shared/google-cookies'

// a minimal Chrome cookie record as the extractor produces it
function chromeCookie(over: Partial<ChromeCookie> = {}): ChromeCookie {
  return {
    host: '.google.com',
    name: 'SID',
    value: 'abc123',
    path: '/',
    // Chrome expires_utc: microseconds since 1601-01-01. This is ~year 2030.
    expiresUtcMicros: 13_569_465_600_000_000,
    secure: false,
    httpOnly: true,
    sameSite: 0, // none/unspecified
    ...over,
  }
}

describe('isGoogleCookie', () => {
  it('accepts google.com and its subdomains', () => {
    expect(isGoogleCookie('.google.com')).toBe(true)
    expect(isGoogleCookie('accounts.google.com')).toBe(true)
    expect(isGoogleCookie('mail.google.com')).toBe(true)
  })

  it('accepts youtube.com (shared Google auth)', () => {
    expect(isGoogleCookie('.youtube.com')).toBe(true)
  })

  it('rejects lookalike and unrelated hosts', () => {
    expect(isGoogleCookie('notgoogle.com')).toBe(false)
    expect(isGoogleCookie('google.com.evil.com')).toBe(false)
    expect(isGoogleCookie('example.com')).toBe(false)
  })
})

describe('toElectronCookie', () => {
  it('forces secure=true when SameSite=None (Chrome stores auth cookies is_secure=0)', () => {
    // this is the gotcha the Phase-0 spike found: without it, Electron rejects
    // every Google auth cookie and the session never logs in
    const c = toElectronCookie(chromeCookie({ secure: false, sameSite: 0 }))
    expect(c.secure).toBe(true)
    expect(c.sameSite).toBe('no_restriction')
    expect(c.url.startsWith('https://')).toBe(true)
  })

  it('maps SameSite lax and strict through', () => {
    expect(toElectronCookie(chromeCookie({ sameSite: 1 })).sameSite).toBe('lax')
    expect(toElectronCookie(chromeCookie({ sameSite: 2 })).sameSite).toBe('strict')
  })

  it('sets a domain for dot-prefixed hosts', () => {
    const c = toElectronCookie(chromeCookie({ host: '.google.com', name: 'SID' }))
    expect(c.domain).toBe('.google.com')
  })

  it('makes __Host- cookies host-only with path=/ and no domain', () => {
    const c = toElectronCookie(chromeCookie({ host: 'accounts.google.com', name: '__Host-GAPS', path: '/somewhere' }))
    expect(c.domain).toBeUndefined()
    expect(c.path).toBe('/')
    expect(c.secure).toBe(true)
  })

  it('forces secure for __Secure- prefixed cookies', () => {
    const c = toElectronCookie(chromeCookie({ name: '__Secure-1PSID', secure: false, sameSite: 1 }))
    expect(c.secure).toBe(true)
  })

  it('builds the url from host (dot-stripped), scheme, and path', () => {
    const c = toElectronCookie(chromeCookie({ host: '.google.com', path: '/', secure: true, sameSite: 1 }))
    expect(c.url).toBe('https://google.com/')
  })

  it('converts Chrome 1601-epoch microseconds to Unix seconds', () => {
    // 13569465600000000 µs since 1601 → subtract 11644473600 s epoch offset
    const c = toElectronCookie(chromeCookie({ expiresUtcMicros: 13_569_465_600_000_000 }))
    expect(c.expirationDate).toBeCloseTo(13_569_465_600_000_000 / 1e6 - 11_644_473_600, 0)
  })

  it('omits expirationDate for session cookies (expires_utc = 0)', () => {
    const c = toElectronCookie(chromeCookie({ expiresUtcMicros: 0 }))
    expect(c.expirationDate).toBeUndefined()
  })

  it('carries name, value, httpOnly through unchanged', () => {
    const c = toElectronCookie(chromeCookie({ name: 'HSID', value: 'xyz', httpOnly: true }))
    expect(c.name).toBe('HSID')
    expect(c.value).toBe('xyz')
    expect(c.httpOnly).toBe(true)
  })
})
