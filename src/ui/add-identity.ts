import type { Session } from '../app/session.js'
import { addIdentityRecord } from '../app/db.js'

/** Thrown when the requested name is already in use by another identity on this signer.
 *  Carries a user-facing message so the UI can show it inline instead of a raw engine string. */
export class DuplicateIdentityError extends Error {
  constructor(name: string) {
    super(`You already have an identity called "${name}"`)
    this.name = 'DuplicateIdentityError'
  }
}

/** Add a named identity to the live session: register it in the Signer, persist the NEW
 * identity, and re-subscribe the relay so it listens for the new identity too. Prior
 * identities are already persisted (onboarding / earlier adds).
 *
 * Checks the name up front, before calling into the signer, so a duplicate is reported with a
 * clear, friendly message (never an unhandled rejection or a silent no-op) and never touches the
 * db or the relay subscription. */
export async function addIdentityLive(opts: { session: Session; name: string }): Promise<{ name: string; npub: string }> {
  if (opts.session.signer.listIdentities().some(i => i.name === opts.name)) {
    throw new DuplicateIdentityError(opts.name)
  }
  const id = opts.session.signer.addIdentity(opts.name)
  await addIdentityRecord({
    name: id.name,
    npub: id.npub,
    pubkeyHex: id.pubkeyHex,
    ...(opts.session.rootKind === 'nsec' ? { derivation: 'derived' as const } : {}),
  })
  // resubscribe (not start): a lock landing during the awaits above must not revive a stopped
  // relay's sockets (L2).
  opts.session.relay.resubscribe(opts.session.signer.listIdentities().map(i => i.pubkeyHex))
  return { name: id.name, npub: id.npub }
}
