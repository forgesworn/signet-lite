// Deterministic, navigator-free crypto for the Lite unlock module.
// PRF→AES-key derivation and master-key generation, lifted from the audited
// signet-app auth.ts. No WebAuthn / navigator access here — that lives in auth.ts.
import { deriveAesKey } from '../engine/aes-crypto.js'

/** App-specific constant salt for the WebAuthn PRF eval AND the HKDF derivation. */
export const PRF_SALT = new Uint8Array([
  0x73, 0x69, 0x67, 0x6e, 0x65, 0x74, 0x2d, 0x6c, // "signet-l"
  0x69, 0x74, 0x65, 0x2d, 0x70, 0x72, 0x66, 0x2d, // "ite-prf-"
  0x76, 0x31, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // "v1" + padding
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 32 bytes total
])

/** Derive a non-extractable AES-256-GCM key from a WebAuthn PRF output via HKDF-SHA256. */
export async function deriveKeyFromPRF(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: PRF_SALT, info: new TextEncoder().encode('signet-lite-encryption-key') },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Derive a non-extractable AES-256-GCM key from BOTH a 6-digit PIN and WebAuthn PRF output. */
export async function deriveKeyFromPinAndPRF(pin: string, prfOutput: ArrayBuffer, salt: Uint8Array): Promise<CryptoKey> {
  const prfHex = Array.from(new Uint8Array(prfOutput), b => b.toString(16).padStart(2, '0')).join('')
  return deriveAesKey(`${pin}:${prfHex}`, salt)
}

/** Generate a random 256-bit master key as a 64-char lowercase hex string. */
export function generateMasterKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
