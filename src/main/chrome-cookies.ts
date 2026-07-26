import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pbkdf2Sync, createDecipheriv } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { isGoogleCookie, type ChromeCookie } from '../shared/google-cookies'

// Reads and decrypts Google cookies from the system Chrome's cookie store on
// macOS. Chrome encrypts cookie values with AES-128-CBC under a key derived
// from a secret held in the login Keychain ("Chrome Safe Storage"); reading it
// prompts the user for Keychain access the first time. macOS-only by design
// (see docs/superpowers/specs/2026-07-22-google-signin-via-system-browser-design.md);
// Node's built-in node:sqlite (Electron 43 = Node 24) reads the DB with no
// runtime dependency.

const COOKIE_DB = join(homedir(), 'Library/Application Support/Google/Chrome/Default/Cookies')

export class ChromeCookiesUnavailable extends Error {}

function safeStorageKey(): Buffer {
  let secret: string
  try {
    secret = execFileSync('security', ['find-generic-password', '-s', 'Chrome Safe Storage', '-w'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    throw new ChromeCookiesUnavailable('Could not read the Chrome Safe Storage key from Keychain')
  }
  // macOS params are fixed by Chromium: salt "saltysalt", 1003 iterations,
  // 16-byte AES-128 key, SHA-1.
  return pbkdf2Sync(secret, 'saltysalt', 1003, 16, 'sha1')
}

function decryptValue(encrypted: Buffer, key: Buffer): string {
  if (encrypted.length === 0) return ''
  // Only the v10 (AES-128-CBC) scheme is present on macOS Chrome. Anything else
  // (e.g. an unencrypted legacy value) is skipped rather than guessed.
  if (encrypted.subarray(0, 3).toString('ascii') !== 'v10') return ''
  const iv = Buffer.alloc(16, ' ') // 16 spaces
  const decipher = createDecipheriv('aes-128-cbc', key, iv)
  decipher.setAutoPadding(false)
  let out = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()])
  // strip PKCS#7 padding manually (autoPadding is off so we can also handle the
  // domain-hash prefix below)
  const pad = out[out.length - 1]
  if (pad > 0 && pad <= 16) out = out.subarray(0, out.length - pad)
  // Chrome v127+ prepends a 32-byte SHA-256(host) to the plaintext. If the
  // first 32 bytes are non-printable, they're that hash — drop them.
  if (out.length > 32 && !out.subarray(0, 32).every((b) => b >= 0x20 && b < 0x7f)) {
    out = out.subarray(32)
  }
  return out.toString('utf8')
}

// Extract all Google/YouTube cookies from the system Chrome, decrypted. Throws
// ChromeCookiesUnavailable if Chrome isn't installed or the Keychain key can't
// be read. Copies the DB first because Chrome keeps the live file locked.
export function extractGoogleCookies(): ChromeCookie[] {
  if (!existsSync(COOKIE_DB)) {
    throw new ChromeCookiesUnavailable('Google Chrome cookie store not found — is Chrome installed?')
  }
  const key = safeStorageKey()
  const tmp = join(tmpdir(), `synapse-chrome-cookies-${process.pid}.db`)
  copyFileSync(COOKIE_DB, tmp)
  try {
    const db = new DatabaseSync(tmp, { readOnly: true })
    try {
      const stmt = db.prepare(
        'SELECT host_key, name, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies',
      )
      // expires_utc can exceed Number.MAX_SAFE_INTEGER (microseconds since 1601);
      // node:sqlite throws on such columns unless BigInt mode is on. We coerce
      // to Number below — the sub-millisecond loss is irrelevant for an expiry.
      stmt.setReadBigInts(true)
      const rows = stmt.all() as Array<{
        host_key: string
        name: string
        encrypted_value: Uint8Array
        path: string
        expires_utc: bigint
        is_secure: bigint
        is_httponly: bigint
        samesite: bigint
      }>
      const cookies: ChromeCookie[] = []
      for (const r of rows) {
        if (!isGoogleCookie(r.host_key)) continue
        const value = decryptValue(Buffer.from(r.encrypted_value), key)
        if (!value) continue
        cookies.push({
          host: r.host_key,
          name: r.name,
          value,
          path: r.path,
          expiresUtcMicros: Number(r.expires_utc),
          secure: r.is_secure === 1n,
          httpOnly: r.is_httponly === 1n,
          sameSite: Number(r.samesite),
        })
      }
      return cookies
    } finally {
      db.close()
    }
  } finally {
    rmSync(tmp, { force: true })
  }
}
