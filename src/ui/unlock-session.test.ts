import { describe, it, expect, beforeEach, vi } from 'vitest'
import { unlockSession } from './unlock-session.js'
import { setupWithPin, unlockWithPin } from '../app/auth.js'
import { addIdentityRecord, putApp, __resetDbForTests } from '../app/db.js'
import { deriveIdentity } from '../engine/derive.js'
import { identityFromNsec, deriveChildFromNsec } from '../engine/nsec.js'
import type { RelayPool } from '../engine/relay.js'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools'
import { bytesToHex } from 'nostr-tools/utils'
import { nip44Encrypt } from '../engine/nip46.js'
import { deleteDB } from 'idb'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const NSEC = 'nsec1gc8hf0g9c33lu0qwj3l7dfstpwmrcskljy88zu4dnmv07sq0el8qftpamx'

async function signReq(clientSk: Uint8Array, idPubHex: string, body: object): Promise<NostrEvent> {
  const content = await nip44Encrypt(bytesToHex(clientSk), idPubHex, JSON.stringify(body))
  return finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', idPubHex]], content }, clientSk)
}

describe('unlockSession', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('decrypts the mnemonic and stands up a Session subscribed to the cached identities', async () => {
    await setupWithPin(M, '123456')
    const mag = deriveIdentity(M, 'magazine')
    await addIdentityRecord({ name: 'magazine', npub: mag.npub, pubkeyHex: mag.pubkeyHex })
    const masterKey = (await unlockWithPin('123456'))!

    const box: { subscribed: string[] } = { subscribed: [] }
    const pool: RelayPool = { subscribe(_r, pks, _cb) { box.subscribed = pks; return { close() {} } }, publish() {}, close() {} }

    const { session, rootKind, identityNames } = await unlockSession(masterKey, { approve: async () => true, pool })
    expect(rootKind).toBe('mnemonic')
    expect(identityNames).toEqual(['magazine'])
    expect(box.subscribed).toEqual([mag.pubkeyHex])
    expect(session.identityPubkeys).toEqual([mag.pubkeyHex])
    session.lock()
  })

  it('works with no cached identities (empty session)', async () => {
    await setupWithPin(M, '123456')
    const masterKey = (await unlockWithPin('123456'))!
    const pool: RelayPool = { subscribe(_r, _pks, _cb) { return { close() {} } }, publish() {}, close() {} }
    const { identityNames } = await unlockSession(masterKey, { approve: async () => true, pool })
    expect(identityNames).toEqual([])
  })

  it('restores persisted app approvals so a previously-connected client can sign after unlock', async () => {
    await setupWithPin(M, '123456')
    const mag = deriveIdentity(M, 'magazine')
    await addIdentityRecord({ name: 'magazine', npub: mag.npub, pubkeyHex: mag.pubkeyHex })

    // Seed a StoredApp representing a client that was approved before the last lock
    const clientSk = generateSecretKey()
    const clientPub = getPublicKey(clientSk)
    await putApp({ clientPubkey: clientPub, identityName: 'magazine', appName: 'TestApp', policy: 'always-allow', connectedAt: Date.now() })

    const masterKey = (await unlockWithPin('123456'))!
    const pool: RelayPool = { subscribe(_r, _pks, _cb) { return { close() {} } }, publish() {}, close() {} }
    const { session } = await unlockSession(masterKey, { approve: async () => true, pool })

    // The client (already authorised at store time) sends a get_public_key request
    const req = await signReq(clientSk, mag.pubkeyHex, { id: '99', method: 'get_public_key', params: [] })
    const response = await session.signer.handleRequestEvent(req)
    // A non-null response means the signer recognised the client as authorised
    expect(response).not.toBeNull()
    session.lock()
  })

  it('forwards onConnect to the session', async () => {
    await setupWithPin(M, '123456')
    const masterKey = (await unlockWithPin('123456'))!
    const onConnect = vi.fn()
    const pool: RelayPool = { subscribe(_r, _pks, _cb) { return { close() {} } }, publish() {}, close() {} }
    const { session } = await unlockSession(masterKey, { approve: async () => true, pool, onConnect })
    // Verify the callback was threaded through — add an identity and enable bunker so we can trigger it
    session.signer.addIdentity('test')
    const { secret } = session.signer.enableBunker('test')
    const testId = deriveIdentity(M, 'test')
    const clientSk = generateSecretKey()
    const clientPub = getPublicKey(clientSk)
    const req = await signReq(clientSk, testId.pubkeyHex, { id: '1', method: 'connect', params: [clientPub, '', secret] })
    await session.signer.handleRequestEvent(req)
    expect(onConnect).toHaveBeenCalledWith('test', clientPub)
    session.lock()
  })

  it('materialises an nsec master: the root is the raw key, plus a derived child', async () => {
    await setupWithPin(NSEC, '123456', 'nsec')
    const root = identityFromNsec(NSEC, 'main')
    const child = deriveChildFromNsec(NSEC, 'work')
    await addIdentityRecord({ name: 'main', npub: root.npub, pubkeyHex: root.pubkeyHex, derivation: 'root' })
    await addIdentityRecord({ name: 'work', npub: child.npub, pubkeyHex: child.pubkeyHex, derivation: 'derived' })
    const masterKey = (await unlockWithPin('123456'))!

    const box: { subscribed: string[] } = { subscribed: [] }
    const pool: RelayPool = { subscribe(_r, pks, _cb) { box.subscribed = pks; return { close() {} } }, publish() {}, close() {} }

    const { session, rootKind } = await unlockSession(masterKey, { approve: async () => true, pool })
    expect(rootKind).toBe('nsec')
    expect(box.subscribed.sort()).toEqual([root.pubkeyHex, child.pubkeyHex].sort())
    expect(session.signer.listIdentities().map(i => i.name).sort()).toEqual(['main', 'work'])
    session.lock()
  })

  // M1: after unlock the signer listens on the user's relays plus every stored app's relays.
  // Records written before the field existed (no `relays`) still load.
  it("subscribes to stored nostrconnect apps' relays as well as the user's, tolerating old records", async () => {
    await setupWithPin(M, '123456')
    const mag = deriveIdentity(M, 'magazine')
    await addIdentityRecord({ name: 'magazine', npub: mag.npub, pubkeyHex: mag.pubkeyHex })
    await putApp({ clientPubkey: 'c1', identityName: 'magazine', appName: 'A', policies: { sign: 'ask', dm: 'ask' }, relays: ['wss://relay.app.example'], connectedAt: 1 })
    await putApp({ clientPubkey: 'c2', identityName: 'magazine', appName: 'Legacy', policy: 'ask', connectedAt: 1 })
    const masterKey = (await unlockWithPin('123456'))!

    const box: { relays: string[] } = { relays: [] }
    const pool: RelayPool = { subscribe(r, _pks, _cb) { box.relays = [...r]; return { close() {} } }, publish() {}, close() {} }
    const { session } = await unlockSession(masterKey, { approve: async () => true, pool })
    expect(box.relays).toContain('wss://relay.app.example')
    expect(box.relays).toContain('wss://relay.damus.io')
    session.lock()
  })
})
