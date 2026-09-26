import { describe, it, expect, beforeEach } from 'vitest'
import { revokeApp } from './revoke-app.js'
import { createSession } from '../app/session.js'
import { deriveIdentity } from '../engine/derive.js'
import { putApp, getApp, __resetDbForTests } from '../app/db.js'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { RelayPool } from '../engine/relay.js'
import { deleteDB } from 'idb'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('revokeApp', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('removes the app from the db and from the signer approved set', async () => {
    const pool: RelayPool = { subscribe(_r, _p, _c) { return { close() {} } }, publish() {}, close() {} }
    const session = createSession({ mnemonic: M, identityNames: ['magazine'], relays: ['wss://r'], approve: async () => true, pool })
    const clientPub = getPublicKey(generateSecretKey())
    await session.signer.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    await putApp({ clientPubkey: clientPub, identityName: 'magazine', appName: 'A', policy: 'always-allow', connectedAt: 0 })

    await revokeApp({ session, identityName: 'magazine', clientPubkey: clientPub })

    expect(await getApp('magazine', clientPub)).toBeUndefined()
    // Signer no longer approves it: a request to magazine from this client is now rejected (null).
    const mag = deriveIdentity(M, 'magazine')
    const reqEvent = { kind: 24133, pubkey: clientPub, tags: [['p', mag.pubkeyHex]], content: 'x', created_at: 0, id: 'i', sig: 's' } as any
    expect(await session.signer.handleRequestEvent(reqEvent)).toBeNull()
  })
})
