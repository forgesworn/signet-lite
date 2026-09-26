import { getRoot } from '../app/auth.js'
import { listIdentities, listApps } from '../app/db.js'
import { loadSessionRelays } from './relays-edit.js'
import { createSession, wrapApprove, type Session } from '../app/session.js'
import { signerFromMnemonic, signerFromNsec } from '../engine/signer.js'
import type { ApprovalRequest, ActivityEvent, ApprovalDecision } from '../engine/signer.js'
import type { RelayPool, RequestReplayStore } from '../engine/relay.js'

/**
 * Build a live signer Session from an unlocked master key: decrypt the root secret,
 * build the matching signer (mnemonic-derived or nsec-rooted), and start the relay.
 * Previously-approved clients are re-authorised so they survive a lock/unlock cycle.
 */
export async function unlockSession(
  masterKey: string,
  opts: {
    approve: (req: ApprovalRequest) => Promise<boolean | ApprovalDecision>
    onConnect?: (identityName: string, clientPubkey: string) => void | Promise<void>
    onActivity?: (entry: ActivityEvent) => void
    pool?: RelayPool
    replayStore?: RequestReplayStore
  },
): Promise<{ session: Session; rootKind: 'mnemonic' | 'nsec'; identityNames: string[] }> {
  const root = await getRoot(masterKey)
  const stored = await listIdentities()
  // The user's relays plus every stored nostrconnect app's relays (M1).
  const relays = await loadSessionRelays()
  const approve = wrapApprove(opts.approve)

  const signer = root.kind === 'nsec'
    ? signerFromNsec(root.secret, stored, { approve, onConnect: opts.onConnect, onActivity: opts.onActivity })
    : signerFromMnemonic(root.secret, stored.map(s => s.name), { approve, onConnect: opts.onConnect, onActivity: opts.onActivity })

  const session = createSession({ signer, rootKind: root.kind, relays, pool: opts.pool, replayStore: opts.replayStore })
  for (const app of await listApps()) {
    session.signer.authorize(app.identityName, app.clientPubkey)
  }
  return { session, rootKind: root.kind, identityNames: stored.map(s => s.name) }
}
