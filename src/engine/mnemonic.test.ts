import { describe, it, expect } from 'vitest'
import { generateMnemonic } from './mnemonic.js'
import { deriveIdentity } from './derive.js'

describe('generateMnemonic', () => {
  it('produces a 12-word English BIP-39 mnemonic that the engine can derive from', () => {
    const m = generateMnemonic()
    expect(m.split(' ')).toHaveLength(12)
    // it must be a valid seed for the engine's derivation
    const id = deriveIdentity(m, 'magazine')
    expect(id.npub).toMatch(/^npub1[0-9a-z]+$/)
    expect(id.pubkeyHex).toMatch(/^[0-9a-f]{64}$/)
  })
  it('produces a different mnemonic each call', () => {
    expect(generateMnemonic()).not.toBe(generateMnemonic())
  })
})
