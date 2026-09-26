import { describe, it, expect, beforeEach } from 'vitest'
import { addIdentityLive, DuplicateIdentityError } from './add-identity.js'
import { createSession } from '../app/session.js'
import { deriveIdentity } from '../engine/derive.js'
import { addIdentityRecord, listIdentities, __resetDbForTests } from '../app/db.js'
import type { RelayPool } from '../engine/relay.js'
import { deleteDB } from 'idb'
import { signerFromNsec } from '../engine/signer.js'
import { identityFromNsec } from '../engine/nsec.js'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const NSEC = 'nsec1gc8hf0g9c33lu0qwj3l7dfstpwmrcskljy88zu4dnmv07sq0el8qftpamx'

describe('addIdentityLive', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('persists the new identity and re-subscribes the relay to all pubkeys', async () => {
    const mag = deriveIdentity(M, 'magazine')
    const meme = deriveIdentity(M, 'meme')
    // Prior identity is already persisted, as it would be after onboarding.
    await addIdentityRecord({ name: 'magazine', npub: mag.npub, pubkeyHex: mag.pubkeyHex })

    let subscribed: string[] = []
    const pool: RelayPool = { subscribe(_r, pks, _c) { subscribed = pks; return { close() {} } }, publish() {}, close() {} }
    const session = createSession({ mnemonic: M, identityNames: ['magazine'], relays: ['wss://r'], approve: async () => true, pool })

    const res = await addIdentityLive({ session, name: 'meme' })

    expect(res.npub).toBe(meme.npub)
    expect((await listIdentities()).map(i => i.name).sort()).toEqual(['magazine', 'meme'])
    expect(subscribed.sort()).toEqual([mag.pubkeyHex, meme.pubkeyHex].sort()) // re-subscribed to BOTH
  })

  // L2: a lock/stop landing while addIdentityLive is mid-flight (e.g. during the addIdentityRecord
  // await) must not revive the relay's sockets on what is now a locked session.
  it('does not resubscribe (revive) a relay that was stopped in the meantime', async () => {
    const mag = deriveIdentity(M, 'magazine')
    await addIdentityRecord({ name: 'magazine', npub: mag.npub, pubkeyHex: mag.pubkeyHex })

    let subscribeCalls = 0
    const pool: RelayPool = { subscribe(_r, _p, _c) { subscribeCalls++; return { close() {} } }, publish() {}, close() {} }
    const session = createSession({ mnemonic: M, identityNames: ['magazine'], relays: ['wss://r'], approve: async () => true, pool })
    subscribeCalls = 0 // ignore the initial subscribe from createSession

    // Start the add, but lock() before its addIdentityRecord() db write resolves — the signer
    // mutation has already happened; only the relay re-subscribe is still pending.
    const addPromise = addIdentityLive({ session, name: 'meme' })
    session.lock()
    await addPromise

    expect(subscribeCalls).toBe(0)
  })

  it('marks identities added under an nsec master as derived', async () => {
    const root = identityFromNsec(NSEC, 'main')
    await addIdentityRecord({ name: 'main', npub: root.npub, pubkeyHex: root.pubkeyHex, derivation: 'root' })
    const pool: RelayPool = { subscribe(_r, _p, _c) { return { close() {} } }, publish() {}, close() {} }
    const signer = signerFromNsec(NSEC, [{ name: 'main', derivation: 'root' }], { approve: async () => true })
    const session = createSession({ signer, rootKind: 'nsec', relays: ['wss://r'], pool })

    await addIdentityLive({ session, name: 'work' })

    const work = (await listIdentities()).find(i => i.name === 'work')
    expect(work?.derivation).toBe('derived')
  })

  it('rejects a duplicate name up front, with a clear message, before touching the signer or db', async () => {
    const mag = deriveIdentity(M, 'magazine')
    await addIdentityRecord({ name: 'magazine', npub: mag.npub, pubkeyHex: mag.pubkeyHex })

    let subscribeCalls = 0
    const pool: RelayPool = { subscribe(_r, _p, _c) { subscribeCalls++; return { close() {} } }, publish() {}, close() {} }
    const session = createSession({ mnemonic: M, identityNames: ['magazine'], relays: ['wss://r'], approve: async () => true, pool })
    subscribeCalls = 0 // ignore the initial subscribe from createSession

    await expect(addIdentityLive({ session, name: 'magazine' }))
      .rejects.toThrow(/you already have an identity called "magazine"/i)
    await expect(addIdentityLive({ session, name: 'magazine' })).rejects.toBeInstanceOf(DuplicateIdentityError)

    // Rejected up front: no new identity record persisted, no re-subscribe triggered.
    expect((await listIdentities()).map(i => i.name)).toEqual(['magazine'])
    expect(subscribeCalls).toBe(0)
  })
})
