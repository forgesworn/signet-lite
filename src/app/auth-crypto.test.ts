import { describe, it, expect } from 'vitest'
import { deriveKeyFromPRF, generateMasterKey, PRF_SALT } from './auth-crypto.js'
import { encryptWithKey, decryptWithKey } from '../engine/crypto-store.js'

describe('auth-crypto', () => {
  it('generateMasterKey returns 64 hex chars and differs each call', () => {
    const a = generateMasterKey()
    const b = generateMasterKey()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })

  it('PRF_SALT is 32 bytes', () => {
    expect(PRF_SALT).toHaveLength(32)
  })

  it('deriveKeyFromPRF is deterministic — same PRF output round-trips', async () => {
    const prf = new Uint8Array(32).fill(7).buffer
    const k1 = await deriveKeyFromPRF(prf)
    const k2 = await deriveKeyFromPRF(prf)
    const wrapped = await encryptWithKey('master-key-hex', k1)
    expect(await decryptWithKey(wrapped, k2)).toBe('master-key-hex')
  })

  it('deriveKeyFromPRF separates distinct PRF outputs', async () => {
    const good = await deriveKeyFromPRF(new Uint8Array(32).fill(1).buffer)
    const wrong = await deriveKeyFromPRF(new Uint8Array(32).fill(2).buffer)
    const wrapped = await encryptWithKey('secret', good)
    await expect(decryptWithKey(wrapped, wrong)).rejects.toThrow()
  })
})
