import { describe, it, expect } from 'vitest'
import { encrypt as nip49Encrypt } from 'nostr-tools/nip49'
import { generateSecretKey } from 'nostr-tools/pure'
import { nsecEncode } from 'nostr-tools/nip19'
import { isValidNsec, parseNsec, identityFromNsec, deriveChildFromNsec, isValidNcryptsec, ncryptsecToNsec } from './nsec.js'

// Cross-tool vector from a real nsec-tree-cli run (also used in derive.test.ts):
// this nsec's own public identity is NPUB.
const NSEC = 'nsec1gc8hf0g9c33lu0qwj3l7dfstpwmrcskljy88zu4dnmv07sq0el8qftpamx'
const NPUB = 'npub10vssllkca9ecvn7dk9pvklls2fjfzyy3mqt3rp683fzepsg7skusaalt7w'

describe('parseNsec / isValidNsec', () => {
  it('decodes a valid nsec to 32 bytes', () => {
    const sk = parseNsec(NSEC)
    expect(sk).toBeInstanceOf(Uint8Array)
    expect(sk!.length).toBe(32)
    expect(isValidNsec(NSEC)).toBe(true)
  })

  it('rejects rubbish, an npub, and the empty string', () => {
    expect(parseNsec('not an nsec')).toBeNull()
    expect(isValidNsec(NPUB)).toBe(false)
    expect(isValidNsec('')).toBe(false)
  })
})

describe('identityFromNsec', () => {
  it("returns the nsec's own identity (the existing npub)", () => {
    const id = identityFromNsec(NSEC, 'main')
    expect(id.name).toBe('main')
    expect(id.npub).toBe(NPUB)
    expect(id.pubkeyHex).toMatch(/^[0-9a-f]{64}$/)
    expect(id.privkeyHex).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('deriveChildFromNsec', () => {
  it('is deterministic for a name, differs from the root, and differs by name', () => {
    const root = identityFromNsec(NSEC, 'root')
    const work1 = deriveChildFromNsec(NSEC, 'work')
    const work2 = deriveChildFromNsec(NSEC, 'work')
    const home = deriveChildFromNsec(NSEC, 'home')
    expect(work1.npub).toBe(work2.npub)        // deterministic
    expect(work1.npub).not.toBe(root.npub)     // child != raw root
    expect(work1.npub).not.toBe(home.npub)     // different names differ
  })
})

describe('ncryptsec import', () => {
  it('detects an ncryptsec by prefix', () => {
    expect(isValidNcryptsec('ncryptsec1xyz')).toBe(true)
    expect(isValidNcryptsec('nsec1xyz')).toBe(false)
  })
  it('decrypts a NIP-49 ncryptsec to the matching nsec', () => {
    const sk = generateSecretKey()
    const expected = nsecEncode(sk)
    const ncryptsec = nip49Encrypt(sk, 'hunter2')
    expect(ncryptsecToNsec(ncryptsec, 'hunter2')).toBe(expected)
  })
  it('throws on a wrong password', () => {
    const ncryptsec = nip49Encrypt(generateSecretKey(), 'right')
    expect(() => ncryptsecToNsec(ncryptsec, 'wrong')).toThrow()
  })
})
