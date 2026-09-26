// The unlock lifecycle: stand up a live Session around a Signer + SignerRelay.
// createSession accepts a prebuilt signer (the root-aware path) or, for convenience,
// a mnemonic + names (the legacy path). The relay pool is injectable for tests.

import type { Event as NostrEvent } from 'nostr-tools'
import { Signer, signerFromMnemonic, type ApprovalRequest, type ApprovalDecision } from '../engine/signer.js'
import { SignerRelay, createSimplePool, type RelayPool, type RequestReplayStore } from '../engine/relay.js'
import { hasHandledRequest, rememberHandledRequest } from './db.js'

export interface Session {
  signer: Signer
  relay: SignerRelay
  identityPubkeys: string[]
  rootKind: 'mnemonic' | 'nsec'
  lock(): void
  publish(event: NostrEvent): void
}

type CommonOpts = { relays: string[]; pool?: RelayPool; replayStore?: RequestReplayStore }
type PrebuiltOpts = CommonOpts & { signer: Signer; rootKind: 'mnemonic' | 'nsec' }
type MnemonicOpts = CommonOpts & {
  mnemonic: string
  identityNames: string[]
  approve: (req: ApprovalRequest) => Promise<boolean | ApprovalDecision>
  onConnect?: (identityName: string, clientPubkey: string) => void | Promise<void>
}
export type CreateSessionOpts = PrebuiltOpts | MnemonicOpts

/** Treat any throw from the approve hook as a denial, so it never escapes the engine. */
export function wrapApprove(approve: (req: ApprovalRequest) => Promise<boolean | ApprovalDecision>): (req: ApprovalRequest) => Promise<boolean | ApprovalDecision> {
  return async (req) => {
    try {
      return await approve(req)
    } catch {
      return false
    }
  }
}

export function createSession(opts: CreateSessionOpts): Session {
  const signer = 'signer' in opts
    ? opts.signer
    : signerFromMnemonic(opts.mnemonic, opts.identityNames, { approve: wrapApprove(opts.approve), onConnect: opts.onConnect })
  const rootKind = 'signer' in opts ? opts.rootKind : 'mnemonic'

  const identityPubkeys = signer.listIdentities().map(i => i.pubkeyHex)
  const pool = opts.pool ?? createSimplePool()
  const replayStore = opts.replayStore ?? { has: hasHandledRequest, remember: rememberHandledRequest }
  const relay = new SignerRelay(signer, opts.relays, pool, replayStore)
  relay.start(identityPubkeys)

  // Reconnect immediately on a foreground/online signal (M1), instead of waiting out the
  // engine's own 1s-60s backoff: a phone waking from sleep or a laptop regaining a network both
  // want the signer listening again right away, not up to a minute later. Only wired up in a
  // browser (window/document exist) and torn down on lock(), so nothing runs once locked.
  let removeReconnectListeners: (() => void) | null = null
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const onVisible = () => { if (document.visibilityState === 'visible') relay.reconnectNow() }
    const onOnline = () => relay.reconnectNow()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    removeReconnectListeners = () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }

  return {
    signer,
    relay,
    identityPubkeys,
    rootKind,
    lock() {
      removeReconnectListeners?.()
      removeReconnectListeners = null
      relay.stop()
      signer.destroy()
    },
    publish: (event) => relay.publish(event),
  }
}
