import { createPublicKey, verify as cryptoVerify } from 'node:crypto'

// raw 32-byte ed25519 public keys (Sparkle's SUPublicEDKey format) need the
// ASN.1 SPKI header prepended before node:crypto can import them
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export function verifyEd25519(data: Buffer, signatureB64: string, publicKeyB64: string): boolean {
  try {
    const raw = Buffer.from(publicKeyB64, 'base64')
    if (raw.byteLength !== 32) return false
    const sig = Buffer.from(signatureB64, 'base64')
    if (sig.byteLength !== 64) return false
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    })
    return cryptoVerify(null, data, key, sig)
  } catch {
    return false
  }
}
