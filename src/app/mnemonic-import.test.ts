import { describe, it, expect } from 'vitest'
import { isValidMnemonic } from './mnemonic-import.js'

const VALID = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('isValidMnemonic', () => {
  it('accepts a valid 12-word phrase', () => {
    expect(isValidMnemonic(VALID)).toBe(true)
  })
  it('tolerates surrounding/odd whitespace and case', () => {
    expect(isValidMnemonic('  ABANDON   abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ABOUT  ')).toBe(true)
  })
  it('rejects a bad checksum (last word wrong)', () => {
    expect(isValidMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon')).toBe(false)
  })
  it('rejects a non-wordlist word', () => {
    expect(isValidMnemonic('zzzz abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')).toBe(false)
  })
  it('rejects the empty string', () => {
    expect(isValidMnemonic('')).toBe(false)
  })
})
