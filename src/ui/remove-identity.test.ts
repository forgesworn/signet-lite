import { describe, it, expect, beforeEach } from 'vitest'
import { removeIdentityLive } from './remove-identity.js'
import { createSession } from '../app/session.js'
import { deriveIdentity } from '../engine/derive.js'
import { addIdentityRecord, putApp, listIdentities, listApps, removeIdentityRecord, saveProfile, loadProfile, appendActivity, listActivity, __resetDbForTests } from '../app/db.js'
import type { RelayPool } from '../engine/relay.js'
import { deleteDB } from 'idb'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('removeIdentityLive', () => {
  let subscribed: string[]
  let pool: RelayPool

  beforeEach(async () => {
    await __resetDbForTests()
    await deleteDB('signet-lite')
    subscribed = []
    pool = { subscribe(_r, pks, _c) { subscribed = pks; return { close() {} } }, publish() {}, close() {} }
  })

  it('removes identity A from signer + db, cleans up its apps, re-subscribes relay to only B', async () => {
    const mag = deriveIdentity(M, 'magazine')
    const meme = deriveIdentity(M, 'meme')

    await addIdentityRecord({ name: 'magazine', npub: mag.npub, pubkeyHex: mag.pubkeyHex })
    await addIdentityRecord({ name: 'meme', npub: meme.npub, pubkeyHex: meme.pubkeyHex })

    // An app connected to magazine identity
    await putApp({ clientPubkey: 'clientA', identityName: 'magazine', appName: 'TestApp', policy: 'ask', connectedAt: 1 })
    // An unrelated app connected to meme (should survive)
    await putApp({ clientPubkey: 'clientB', identityName: 'meme', appName: 'OtherApp', policy: 'ask', connectedAt: 2 })

    const session = createSession({
      mnemonic: M,
      identityNames: ['magazine', 'meme'],
      relays: ['wss://r'],
      approve: async () => true,
      pool,
    })

    await removeIdentityLive({ session, name: 'magazine' })

    // magazine gone from signer
    expect(session.signer.listIdentities().map(i => i.name)).toEqual(['meme'])

    // magazine gone from db
    const dbIds = (await listIdentities()).map(i => i.name)
    expect(dbIds).toEqual(['meme'])

    // magazine's app gone from db
    const apps = await listApps()
    expect(apps.map(a => a.clientPubkey)).toEqual(['clientB'])

    // relay re-subscribed to only meme's pubkey
    expect(subscribed).toEqual([meme.pubkeyHex])
  })

  // L2: a lock/stop landing mid-flight must not revive the relay's sockets on a now-locked session.
  it('does not resubscribe (revive) a relay that was stopped in the meantime', async () => {
    const mag = deriveIdentity(M, 'magazine')
    const meme = deriveIdentity(M, 'meme')
    await addIdentityRecord({ name: 'magazine', npub: mag.npub, pubkeyHex: mag.pubkeyHex })
    await addIdentityRecord({ name: 'meme', npub: meme.npub, pubkeyHex: meme.pubkeyHex })

    let subscribeCalls = 0
    const countingPool: RelayPool = { subscribe(_r, pks, _c) { subscribeCalls++; subscribed = pks; return { close() {} } }, publish() {}, close() {} }
    const session = createSession({
      mnemonic: M,
      identityNames: ['magazine', 'meme'],
      relays: ['wss://r'],
      approve: async () => true,
      pool: countingPool,
    })
    subscribeCalls = 0 // ignore the initial subscribe from createSession

    // Start the removal, but lock() before its db writes resolve — the signer mutation has
    // already happened; only the relay re-subscribe is still pending.
    const removePromise = removeIdentityLive({ session, name: 'magazine' })
    session.lock()
    await removePromise

    expect(subscribeCalls).toBe(0)
  })

  it('is a no-op for an unknown identity name', async () => {
    const mag = deriveIdentity(M, 'magazine')
    await addIdentityRecord({ name: 'magazine', npub: mag.npub, pubkeyHex: mag.pubkeyHex })

    const session = createSession({
      mnemonic: M,
      identityNames: ['magazine'],
      relays: ['wss://r'],
      approve: async () => true,
      pool,
    })

    await expect(removeIdentityLive({ session, name: 'nonexistent' })).resolves.toBeUndefined()
    expect(session.signer.listIdentities()).toHaveLength(1)
  })

  // L11: re-adding the same name later must not inherit the deleted identity's cached profile
  // (display name/avatar on a different key) or its activity history.
  it("removes the identity's profile and activity rows, leaving other identities' intact", async () => {
    const mag = deriveIdentity(M, 'magazine')
    const meme = deriveIdentity(M, 'meme')
    await addIdentityRecord({ name: 'magazine', npub: mag.npub, pubkeyHex: mag.pubkeyHex })
    await addIdentityRecord({ name: 'meme', npub: meme.npub, pubkeyHex: meme.pubkeyHex })
    await saveProfile({ name: 'magazine', metadata: { name: 'Mag' }, updatedAt: 1 })
    await saveProfile({ name: 'meme', metadata: { name: 'Meme' }, updatedAt: 1 })
    const ts = Math.floor(Date.now() / 1000)
    await appendActivity({ ts, identityName: 'magazine', clientPubkey: 'c1', method: 'sign_event', outcome: 'signed' })
    await appendActivity({ ts, identityName: 'meme', clientPubkey: 'c2', method: 'sign_event', outcome: 'signed' })

    const session = createSession({ mnemonic: M, identityNames: ['magazine', 'meme'], relays: ['wss://r'], approve: async () => true, pool })
    await removeIdentityLive({ session, name: 'magazine' })

    expect(await loadProfile('magazine')).toBeUndefined()
    expect(await loadProfile('meme')).toBeDefined()
    expect((await listActivity()).map(e => e.identityName)).toEqual(['meme'])
  })
})
