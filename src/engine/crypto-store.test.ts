import { describe, it, expect } from 'vitest'
import { encryptSecret, decryptSecret, isEncrypted, encryptWithKey, decryptWithKey } from './crypto-store.js'

describe('crypto-store', () => {
  it('round-trips a secret with the right passphrase', async () => {
    const enc = await encryptSecret('twelve word seed here', 'hunter2')
    expect(isEncrypted(enc)).toBe(true)
    expect(await decryptSecret(enc, 'hunter2')).toBe('twelve word seed here')
  })
  it('fails to decrypt with the wrong passphrase', async () => {
    const enc = await encryptSecret('secret', 'right')
    await expect(decryptSecret(enc, 'wrong')).rejects.toThrow()
  })
})

describe('crypto-store key-based path', () => {
  async function freshKey() {
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  }
  it('round-trips a secret with a provided AES key', async () => {
    const key = await freshKey()
    const enc = await encryptWithKey('twelve word seed', key)
    expect(await decryptWithKey(enc, key)).toBe('twelve word seed')
  })
  it('fails to decrypt with a different key', async () => {
    const enc = await encryptWithKey('secret', await freshKey())
    await expect(decryptWithKey(enc, await freshKey())).rejects.toThrow()
  })
})
