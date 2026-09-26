import { generateMnemonic as scureGenerate } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

/** Generate a fresh 12-word BIP-39 mnemonic (128 bits of entropy, English wordlist). */
export function generateMnemonic(): string {
  return scureGenerate(wordlist, 128)
}
