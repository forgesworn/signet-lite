import { describe, it, expect, vi } from 'vitest'
import { createSession } from './session.js'
import { deriveIdentity } from '../engine/derive.js'
import type { RelayPool } from '../engine/relay.js'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools'
import { bytesToHex } from 'nostr-tools/utils'
import { nip44Encrypt } from '../engine/nip46.js'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

function fakePool() {
  const state: { onEvent: ((e: NostrEvent) => void | Promise<void>) | null; subscribedPubkeys: string[]; published: NostrEvent[]; closed: boolean } =
    { onEvent: null, subscribedPubkeys: [], published: [], closed: false }
  const pool: RelayPool = {
    subscribe(_relays, pubkeys, cb) { state.onEvent = cb; state.subscribedPubkeys = pubkeys; return { close() {} } },
    publish(_relays, ev) { state.published.push(ev) },
    close() { state.closed = true },
  }
  return { pool, state }
}

async function signReq(clientSk: Uint8Array, idPubHex: string, body: object): Promise<NostrEvent> {
  const content = await nip44Encrypt(bytesToHex(clientSk), idPubHex, JSON.stringify(body))
  return finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', idPubHex]], content }, clientSk)
}

describe('createSession', () => {
  it('starts a relay subscribed to every identity pubkey', () => {
    const { pool, state } = fakePool()
    const mag = deriveIdentity(M, 'magazine')
    const meme = deriveIdentity(M, 'meme')
    createSession({ mnemonic: M, identityNames: ['magazine', 'meme'], relays: ['wss://r'], approve: async () => true, pool })
    expect(state.subscribedPubkeys.sort()).toEqual([mag.pubkeyHex, meme.pubkeyHex].sort())
  })

  it('routes an approved request through the signer and publishes a response', async () => {
    const { pool, state } = fakePool()
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey()
    const clientPub = getPublicKey(clientSk)
    const session = createSession({ mnemonic: M, identityNames: ['magazine'], relays: ['wss://r'], approve: async () => true, pool })
    await session.signer.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')

    const req = await signReq(clientSk, mag.pubkeyHex, { id: '1', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'hi' })] })
    await state.onEvent!(req)
    expect(state.published).toHaveLength(1)
  })

  it('a throwing approve hook is treated as a denial, never propagates', async () => {
    const { pool, state } = fakePool()
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey()
    const clientPub = getPublicKey(clientSk)
    const session = createSession({
      mnemonic: M, identityNames: ['magazine'], relays: ['wss://r'],
      approve: async () => { throw new Error('UI exploded') }, pool,
    })
    await session.signer.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')

    const req = await signReq(clientSk, mag.pubkeyHex, { id: '2', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'x' })] })
    await expect(state.onEvent!(req)).resolves.not.toThrow()
    // A denied response is still published (encrypted error), but it is not a signed event template.
    expect(state.published).toHaveLength(1)
  })

  it('lock() stops the subscription and closes the pool', () => {
    const { pool, state } = fakePool()
    const session = createSession({ mnemonic: M, identityNames: ['magazine'], relays: ['wss://r'], approve: async () => true, pool })
    session.lock()
    expect(state.closed).toBe(true)
    expect(session.signer.listIdentities()).toEqual([])
  })

  it('exposes publish that delegates to the relay/pool', () => {
    const published: NostrEvent[] = []
    const pool: RelayPool = { subscribe(_r, _p, _c) { return { close() {} } }, publish(_r, ev) { published.push(ev) }, close() {} }
    const session = createSession({ mnemonic: M, identityNames: ['magazine'], relays: ['wss://r'], approve: async () => true, pool })
    const ev = { id: 'x', kind: 24133, pubkey: 'aa', created_at: 0, tags: [], content: 'c', sig: 's' } as unknown as NostrEvent
    session.publish(ev)
    expect(published).toEqual([ev])
  })

  it('forwards onConnect to the Signer so it fires when a new client connects via bunker secret', async () => {
    const { pool, state } = fakePool()
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey()
    const clientPub = getPublicKey(clientSk)
    const onConnect = vi.fn()

    const session = createSession({
      mnemonic: M, identityNames: ['magazine'], relays: ['wss://r'],
      approve: async () => true, pool, onConnect,
    })

    // Enable bunker mode to get a secret the client must present
    const { secret } = session.signer.enableBunker('magazine')

    // Simulate a `connect` request from a new (unapproved) client carrying the secret
    const req = await signReq(clientSk, mag.pubkeyHex, { id: '42', method: 'connect', params: [clientPub, '', secret] })
    await state.onEvent!(req)

    expect(onConnect).toHaveBeenCalledOnce()
    expect(onConnect).toHaveBeenCalledWith('magazine', clientPub)
  })
})
