import { fromMnemonic, derive } from 'nsec-tree'
import { bytesToHex } from 'nostr-tools/utils'

/** A Nostr identity with its keys resolved in memory, ready for signing. */
export interface ResolvedIdentity {
  name: string
  npub: string
  pubkeyHex: string
  privkeyHex: string
}

export function deriveIdentity(mnemonic: string, name: string): ResolvedIdentity {
  const root = fromMnemonic(mnemonic)
  try {
    const id = derive(root, name, 0)
    return {
      name,
      npub: id.npub,
      pubkeyHex: bytesToHex(id.publicKey),
      privkeyHex: bytesToHex(id.privateKey),
    }
  } finally {
    root.destroy()
  }
}
