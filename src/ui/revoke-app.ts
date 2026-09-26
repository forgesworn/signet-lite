import type { Session } from '../app/session.js'
import { removeApp } from '../app/db.js'

/** Revoke a connected app for one identity: drop its policy record and live signing authority. */
export async function revokeApp(opts: { session: Session; identityName: string; clientPubkey: string }): Promise<void> {
  await removeApp(opts.identityName, opts.clientPubkey)
  opts.session.signer.revokeForIdentity(opts.identityName, opts.clientPubkey)
}
