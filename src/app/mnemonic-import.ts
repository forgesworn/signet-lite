import { validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

/**
 * Validate a user-typed recovery phrase against the English BIP-39 wordlist
 * (including the checksum). Normalises case and whitespace first, since
 * nsec-tree's derivation will not itself reject a malformed phrase.
 */
export function isValidMnemonic(phrase: string): boolean {
  const normalised = phrase.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!normalised) return false
  try {
    return validateMnemonic(normalised, wordlist)
  } catch {
    return false
  }
}
