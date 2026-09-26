import type { Session } from '../app/session.js'
import { listApps, removeApp, removeIdentityRecord, removeProfile, clearActivity } from '../app/db.js'

/** Remove a named identity from the live session: revoke all its connected apps,
 * remove it from the Signer, delete its db record, and re-subscribe the relay
 * to the remaining identities only. The key is always re-derivable from the seed. */
export async function removeIdentityLive(opts: { session: Session; name: string }): Promise<void> {
  const { session, name } = opts

  // Revoke and remove every app belonging to this identity
  const apps = await listApps()
  for (const app of apps) {
    if (app.identityName === name) {
      session.signer.revokeForIdentity(name, app.clientPubkey)
      await removeApp(name, app.clientPubkey)
    }
  }

  // Remove from the signer in-memory state
  session.signer.removeIdentity(name)

  // Remove from the db, with its cached profile and activity history (L11): a later identity
  // re-added under the same name must not inherit the old display name/avatar or log.
  await removeIdentityRecord(name)
  await removeProfile(name)
  await clearActivity({ identityName: name })

  // Re-subscribe relay to the remaining identities. resubscribe (not start): a lock landing
  // during the awaits above must not revive a stopped relay's sockets (L2).
  session.relay.resubscribe(session.signer.listIdentities().map(i => i.pubkeyHex))
}
