import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyEd25519 } from '../src/main/ed25519'

// raw 32-byte public key = last 32 bytes of the SPKI DER export
function keypair(): { publicB64: string; sign: (data: Buffer) => string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' })
  return {
    publicB64: Buffer.from(spki.subarray(spki.byteLength - 32)).toString('base64'),
    sign: (data) => cryptoSign(null, data, privateKey).toString('base64'),
  }
}

describe('verifyEd25519', () => {
  it('verifies a valid signature (sparkle sign_update format: raw key + raw sig, base64)', () => {
    const { publicB64, sign } = keypair()
    const data = Buffer.from('this is a dmg, trust me')
    expect(verifyEd25519(data, sign(data), publicB64)).toBe(true)
  })

  it('rejects tampered data and foreign signatures', () => {
    const a = keypair()
    const b = keypair()
    const data = Buffer.from('payload')
    expect(verifyEd25519(Buffer.from('payloax'), a.sign(data), a.publicB64)).toBe(false)
    expect(verifyEd25519(data, b.sign(data), a.publicB64)).toBe(false)
  })

  it('returns false (not throw) on malformed inputs', () => {
    const { publicB64, sign } = keypair()
    const data = Buffer.from('x')
    expect(verifyEd25519(data, 'not base64!!!', publicB64)).toBe(false)
    expect(verifyEd25519(data, sign(data), 'dG9vc2hvcnQ=')).toBe(false)
    expect(verifyEd25519(data, '', '')).toBe(false)
  })
})
