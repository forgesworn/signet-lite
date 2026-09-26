import { fromNsec, derive } from 'nsec-tree'
import { getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { nsecEncode } from 'nostr-tools/nip19'
import { decrypt as nip49Decrypt } from 'nostr-tools/nip49'
import { bytesToHex } from 'nostr-tools/utils'
import type { ResolvedIdentity } from './derive.js'

/** Decode a bech32 `nsec1…` to its 32-byte secret, or null if it is not a valid nsec. */
export function parseNsec(input: string): Uint8Array | null {
  try {
    const decoded = nip19.decode(input.trim())
    if (decoded.type !== 'nsec') return null
    return decoded.data
  } catch {
    return null
  }
}

/** Whether the input is a valid bech32 nsec (checksum included). */
export function isValidNsec(input: string): boolean {
  return parseNsec(input) !== null
}

/** The nsec's OWN identity: sign directly with the raw key. This is the root identity. */
export function identityFromNsec(nsec: string, name: string): ResolvedIdentity {
  const sk = parseNsec(nsec)
  if (!sk) throw new Error('invalid nsec')
  const pubkeyHex = getPublicKey(sk)
  return { name, npub: nip19.npubEncode(pubkeyHex), pubkeyHex, privkeyHex: bytesToHex(sk) }
}

/** True for a NIP-49 password-encrypted key string. */
export function isValidNcryptsec(s: string): boolean {
  return /^ncryptsec1[02-9ac-hj-np-z]+$/.test(s.trim())
}

/** Decrypt a NIP-49 ncryptsec to an nsec.  Throws on a wrong password or malformed input.
 *  The raw secret bytes are wiped after encoding so they do not linger in memory. */
export function ncryptsecToNsec(ncryptsec: string, password: string): string {
  const bytes = nip49Decrypt(ncryptsec.trim(), password)
  try {
    return nsecEncode(bytes)
  } finally {
    bytes.fill(0)
  }
}

/** A named child identity derived from the nsec via the nsec-tree root. Mirrors deriveIdentity. */
export function deriveChildFromNsec(nsec: string, name: string): ResolvedIdentity {
  const root = fromNsec(nsec)
  try {
    const id = derive(root, name, 0)
    return { name, npub: id.npub, pubkeyHex: bytesToHex(id.publicKey), privkeyHex: bytesToHex(id.privateKey) }
  } finally {
    root.destroy()
  }
}
