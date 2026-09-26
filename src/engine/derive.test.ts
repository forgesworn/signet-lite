import { describe, it, expect } from 'vitest'
import { deriveIdentity } from './derive.js'
import { fromMnemonic } from 'nsec-tree'
import { nip19 } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('deriveIdentity', () => {
  it('is deterministic for a given mnemonic + name', () => {
    const id = deriveIdentity(M, 'magazine')
    expect(id.npub).toBe('npub1kfq6y5955l7fufkx45c0wc57mgdwm6rytl4h3j89uy3tkpvyv96s777nuz')
    expect(id.pubkeyHex).toBe('b241a250b4a7fc9e26c6ad30f7629eda1aede8645feb78c8e5e122bb05846175')
    expect(id.privkeyHex).toMatch(/^[0-9a-f]{64}$/)
  })

  it('different names give different identities; same name is deterministic', () => {
    expect(deriveIdentity(M, 'magazine').npub).not.toBe(deriveIdentity(M, 'meme').npub)
    expect(deriveIdentity(M, 'meme').npub).toBe(deriveIdentity(M, 'meme').npub)
  })
})

// Cross-tool invariant: My Signet Lite, nsec-tree-cli and bray all derive identical
// keys from one mnemonic. Vectors below were captured from a real `nsec-tree-cli` run
// (2026-06-23), so this is an INDEPENDENT check, not a self-captured snapshot:
//   npx nsec-tree-cli root create --name master                 (CLI_MNEMONIC)
//   npx nsec-tree-cli export npub passphrase --profile master   -> passphrase@0 npub
//   npx nsec-tree-cli export nsec passphrase --profile master   -> passphrase@0 nsec
const CLI_MNEMONIC = 'beauty clog outside grant mule afford beyond flat food deposit father join'
const CLI_MASTER_NPUB = 'npub1fdyk6xav7lhm65s0gh0w47wdujpc786l3lmwyfpfeqwv34xy6d2qgk0ynh'
const CLI_PASSPHRASE_NPUB = 'npub10vssllkca9ecvn7dk9pvklls2fjfzyy3mqt3rp683fzepsg7skusaalt7w'
const CLI_PASSPHRASE_NSEC = 'nsec1gc8hf0g9c33lu0qwj3l7dfstpwmrcskljy88zu4dnmv07sq0el8qftpamx'

describe('nsec-tree-cli cross-tool vectors', () => {
  it('the tree root master npub equals the CLI master npub', () => {
    const root = fromMnemonic(CLI_MNEMONIC)
    try {
      expect(root.masterPubkey).toBe(CLI_MASTER_NPUB)
    } finally {
      root.destroy()
    }
  })

  it('deriveIdentity(_, "passphrase") matches the CLI export npub AND nsec exactly', () => {
    const id = deriveIdentity(CLI_MNEMONIC, 'passphrase')
    expect(id.npub).toBe(CLI_PASSPHRASE_NPUB)
    expect(nip19.nsecEncode(hexToBytes(id.privkeyHex))).toBe(CLI_PASSPHRASE_NSEC)
  })
})
