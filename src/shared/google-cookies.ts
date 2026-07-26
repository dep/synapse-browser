// Pure mapping between Chrome's on-disk cookie records and Electron's
// Cookies.set shape, for importing a Google website session from the system
// Chrome into a Synapse session. Electron-free so it's unit-tested; the
// extraction (decrypting Chrome's DB) and the actual cookies.set live in main.

// A decrypted Chrome cookie row (see src/main/chrome-cookies.ts).
export interface ChromeCookie {
  host: string // host_key, e.g. ".google.com" or "accounts.google.com"
  name: string
  value: string
  path: string
  // Chrome expires_utc: microseconds since 1601-01-01 (0 = session cookie)
  expiresUtcMicros: number
  secure: boolean // is_secure (note: Google auth cookies store this as 0)
  httpOnly: boolean
  sameSite: number // Chrome enum: -1/0 none-or-unspecified, 1 lax, 2 strict
}

// The subset of Electron's Cookies.set arg we populate.
export interface ElectronCookie {
  url: string
  name: string
  value: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
  domain?: string
  expirationDate?: number
}

// Unix epoch is 11644473600 seconds after the 1601 Windows epoch Chrome uses.
const EPOCH_OFFSET_SECONDS = 11_644_473_600

const GOOGLE_HOSTS = ['google.com', 'youtube.com']

// True if a cookie host belongs to a Google auth domain (the domain itself or
// a subdomain). Guards against lookalikes like "notgoogle.com" or
// "google.com.evil.com".
export function isGoogleCookie(host: string): boolean {
  const h = host.replace(/^\./, '').toLowerCase()
  return GOOGLE_HOSTS.some((g) => h === g || h.endsWith('.' + g))
}

function sameSite(n: number): ElectronCookie['sameSite'] {
  if (n === 2) return 'strict'
  if (n === 1) return 'lax'
  // Chrome's none/unspecified both map to no_restriction; Google's cross-site
  // auth cookies rely on SameSite=None, which Chromium requires be Secure.
  return 'no_restriction'
}

export function toElectronCookie(c: ChromeCookie): ElectronCookie {
  const ss = sameSite(c.sameSite)
  const isHost = c.name.startsWith('__Host-')
  const isSecurePrefixed = isHost || c.name.startsWith('__Secure-')
  // SameSite=None REQUIRES Secure in Chromium/Electron, and __Secure-/__Host-
  // cookies are Secure by definition. Chrome stores Google auth cookies with
  // is_secure=0 even though they're HTTPS-only, so we can't trust c.secure
  // alone — without this the auth cookies are rejected and login never sticks
  // (verified in the Phase-0 spike).
  const secure = c.secure || ss === 'no_restriction' || isSecurePrefixed
  // __Host- cookies must be host-only (no domain) with path "/"; everything
  // else keeps a leading-dot domain as a domain cookie.
  const path = isHost ? '/' : c.path || '/'
  const hostNoDot = c.host.replace(/^\./, '')
  const out: ElectronCookie = {
    url: `${secure ? 'https' : 'http'}://${hostNoDot}${path}`,
    name: c.name,
    value: c.value,
    path,
    secure,
    httpOnly: c.httpOnly,
    sameSite: ss,
  }
  if (c.host.startsWith('.') && !isHost) out.domain = c.host
  if (c.expiresUtcMicros > 0) out.expirationDate = c.expiresUtcMicros / 1e6 - EPOCH_OFFSET_SECONDS
  return out
}
