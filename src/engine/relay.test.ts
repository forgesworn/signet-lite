import { describe, it, expect, vi, afterEach } from 'vitest'
import { SignerRelay, wrapSimplePool, type RelayPool, type RelaySubscribeOptions, type PoolLike } from './relay.js'
import { signerFromMnemonic } from './signer.js'
import { deriveIdentity } from './derive.js'
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools'
import { bytesToHex } from 'nostr-tools/utils'
import { nip44Encrypt } from './nip46.js'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

async function signReq(clientSk: Uint8Array, idPubHex: string, body: object): Promise<NostrEvent> {
  const content = await nip44Encrypt(bytesToHex(clientSk), idPubHex, JSON.stringify(body))
  return finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', idPubHex]], content }, clientSk)
}

describe('SignerRelay', () => {
  it('routes an inbound request to the signer and publishes its encrypted response', async () => {
    const s = signerFromMnemonic(M, ['magazine'], { approve: async () => true })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')

    let onEvent: ((e: NostrEvent) => void | Promise<void>) | null = null
    const published: NostrEvent[] = []
    const fake: RelayPool = {
      subscribe(_r, _pks, cb) { onEvent = cb; return { close() {} } },
      publish(_r, ev) { published.push(ev) },
      close() {},
    }
    new SignerRelay(s, ['wss://r'], fake).start([mag.pubkeyHex])
    expect(onEvent).not.toBeNull()

    const reqEv = await signReq(clientSk, mag.pubkeyHex, { id: '1', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'hi' })] })
    await onEvent!(reqEv)

    expect(published.length).toBe(1)
    expect(verifyEvent(published[0])).toBe(true)
    expect(published[0].pubkey).toBe(mag.pubkeyHex)
  })

  it('handles each request event once, even when a relay re-delivers it', async () => {
    const s = signerFromMnemonic(M, ['magazine'], { approve: async () => true })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')

    let onEvent: ((e: NostrEvent) => void | Promise<void>) | null = null
    const published: NostrEvent[] = []
    const fake: RelayPool = { subscribe(_r, _p, cb) { onEvent = cb; return { close() {} } }, publish(_r, ev) { published.push(ev) }, close() {} }
    new SignerRelay(s, ['wss://r'], fake).start([mag.pubkeyHex])

    const reqEv = await signReq(clientSk, mag.pubkeyHex, { id: '1', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'hi' })] })
    await onEvent!(reqEv)
    await onEvent!(reqEv)   // same event id re-delivered by the relay
    await onEvent!(reqEv)

    expect(published.length).toBe(1) // signed and published exactly once
  })

  it('handles a request exactly once even when two deliveries race through an async replay-store check', async () => {
    let handleCalls = 0
    const fakeSigner = {
      async handleRequestEvent(_event: NostrEvent) {
        handleCalls++
        return { id: 'resp', kind: 24133, pubkey: 'aa', created_at: 0, tags: [], content: 'c', sig: 's' } as unknown as NostrEvent
      },
    }
    // An async replayStore.has() is the real-world await point (e.g. IndexedDB) between the
    // synchronous inFlight check and inFlight being marked — this is what a naive ordering races on.
    const replayStore = {
      async has() {
        await new Promise(r => setTimeout(r, 5))
        return false
      },
      async remember() {
        return false
      },
    }
    const published: NostrEvent[] = []
    let onEvent: ((e: NostrEvent) => void | Promise<void>) | null = null
    const fake: RelayPool = { subscribe(_r, _p, cb) { onEvent = cb; return { close() {} } }, publish(_r, ev) { published.push(ev) }, close() {} }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new SignerRelay(fakeSigner as any, ['wss://r'], fake, replayStore).start(['pk'])

    const reqEv = { id: 'concurrent-1', kind: 24133, pubkey: 'client', created_at: Math.floor(Date.now() / 1000), tags: [], content: 'x', sig: 'y' } as unknown as NostrEvent
    // Two "concurrent" deliveries: the second is fired before the first has awaited past the
    // replay-store check, mirroring two relays redelivering the same event near-simultaneously.
    const p1 = onEvent!(reqEv)
    const p2 = onEvent!(reqEv)
    await Promise.all([p1, p2])

    expect(handleCalls).toBe(1)
    expect(published.length).toBe(1)
  })

  it('still handles distinct request events that happen to carry the same NIP-46 id', async () => {
    const s = signerFromMnemonic(M, ['magazine'], { approve: async () => true })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')

    let onEvent: ((e: NostrEvent) => void | Promise<void>) | null = null
    const published: NostrEvent[] = []
    const fake: RelayPool = { subscribe(_r, _p, cb) { onEvent = cb; return { close() {} } }, publish(_r, ev) { published.push(ev) }, close() {} }
    new SignerRelay(s, ['wss://r'], fake).start([mag.pubkeyHex])

    // Two separate events (nip44 nonces differ ⇒ different event ids) reusing request id '1'.
    await onEvent!(await signReq(clientSk, mag.pubkeyHex, { id: '1', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'hi' })] }))
    await onEvent!(await signReq(clientSk, mag.pubkeyHex, { id: '1', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'hi' })] }))
    expect(published.length).toBe(2)
  })

  it('publish() sends an event to the configured relays via the pool', () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const published: NostrEvent[] = []
    const fake: RelayPool = { subscribe(_r, _p, _cb) { return { close() {} } }, publish(_r, ev) { published.push(ev) }, close() {} }
    const relay = new SignerRelay(s, ['wss://r'], fake)
    const ev = { id: 'x', kind: 24133, pubkey: 'aa', created_at: 0, tags: [], content: 'c', sig: 's' } as unknown as NostrEvent
    relay.publish(ev)
    expect(published).toEqual([ev])
  })

  it('publishes nothing for an unpaired client (signer returns null)', async () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const strangerSk = generateSecretKey()
    let onEvent: ((e: NostrEvent) => void | Promise<void>) | null = null
    const published: NostrEvent[] = []
    const fake: RelayPool = { subscribe(_r, _p, cb) { onEvent = cb; return { close() {} } }, publish(_r, ev) { published.push(ev) }, close() {} }
    new SignerRelay(s, ['wss://r'], fake).start([mag.pubkeyHex])
    const reqEv = await signReq(strangerSk, mag.pubkeyHex, { id: '2', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'x' })] })
    await onEvent!(reqEv)
    expect(published.length).toBe(0)
  })

  it('does not remember unauthenticated junk in the replay store', async () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const strangerSk = generateSecretKey()
    let onEvent: ((e: NostrEvent) => void | Promise<void>) | null = null
    let rememberCalls = 0
    const replayStore = {
      has: async () => false,
      remember: async () => {
        rememberCalls++
        return false
      },
    }
    const fake: RelayPool = { subscribe(_r, _p, cb) { onEvent = cb; return { close() {} } }, publish() {}, close() {} }
    new SignerRelay(s, ['wss://r'], fake, replayStore).start([mag.pubkeyHex])

    const reqEv = await signReq(strangerSk, mag.pubkeyHex, { id: 'junk', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'x' })] })
    await onEvent!(reqEv)

    expect(rememberCalls).toBe(0)
  })

  it('reconnectNow() re-subscribes to the same relays and identities immediately', () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const calls: { relays: string[]; pubkeys: string[] }[] = []
    const fake: RelayPool = { subscribe(relays, pubkeys, _cb) { calls.push({ relays, pubkeys }); return { close() {} } }, publish() {}, close() {} }
    const relay = new SignerRelay(s, ['wss://a'], fake)
    relay.start([mag.pubkeyHex])
    relay.reconnectNow()
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({ relays: ['wss://a'], pubkeys: [mag.pubkeyHex] })
  })

  it('reconnectNow() is a no-op before start() and after stop()', () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const calls: unknown[] = []
    const fake: RelayPool = { subscribe(...args) { calls.push(args); return { close() {} } }, publish() {}, close() {} }
    const relay = new SignerRelay(s, ['wss://a'], fake)
    relay.reconnectNow()
    expect(calls).toHaveLength(0) // never started

    relay.start([])
    expect(calls).toHaveLength(1)
    relay.stop()
    relay.reconnectNow()
    expect(calls).toHaveLength(1) // stopped: no new subscribe
  })

  it('resubscribe() re-subscribes to a new identity list immediately (L2)', () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const calls: { relays: string[]; pubkeys: string[] }[] = []
    const fake: RelayPool = { subscribe(relays, pubkeys, _cb) { calls.push({ relays, pubkeys }); return { close() {} } }, publish() {}, close() {} }
    const relay = new SignerRelay(s, ['wss://a'], fake)
    relay.start([])
    relay.resubscribe([mag.pubkeyHex])
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({ relays: ['wss://a'], pubkeys: [mag.pubkeyHex] })
  })

  it('resubscribe() is a no-op before start() and after stop() — never resurrects a locked session (L2)', () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const calls: unknown[] = []
    const fake: RelayPool = { subscribe(...args) { calls.push(args); return { close() {} } }, publish() {}, close() {} }
    const relay = new SignerRelay(s, ['wss://a'], fake)
    relay.resubscribe([mag.pubkeyHex])
    expect(calls).toHaveLength(0) // never started

    relay.start([])
    expect(calls).toHaveLength(1)
    relay.stop()
    relay.resubscribe([mag.pubkeyHex])
    expect(calls).toHaveLength(1) // stopped: no revival, no new subscribe

    // Unlike resubscribe(), start() itself is still the genuine-restart path.
    relay.start([mag.pubkeyHex])
    expect(calls).toHaveLength(2)
  })

  it('setRelays() re-points and re-subscribes to the same identities', () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const calls: { relays: string[]; pubkeys: string[] }[] = []
    const fake: RelayPool = { subscribe(relays, pubkeys, _cb) { calls.push({ relays, pubkeys }); return { close() {} } }, publish() {}, close() {} }
    const relay = new SignerRelay(s, ['wss://a'], fake)
    relay.start([mag.pubkeyHex])
    relay.setRelays(['wss://b', 'wss://c'])
    expect(calls).toHaveLength(2)
    expect(calls[1].relays).toEqual(['wss://b', 'wss://c'])
    expect(calls[1].pubkeys).toEqual([mag.pubkeyHex])
  })

  it('subscribes with a recent since filter', () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    let opts: RelaySubscribeOptions | undefined
    const fake: RelayPool = {
      subscribe(_r, _pks, _cb, o) { opts = o; return { close() {} } },
      publish() {},
      close() {},
    }
    new SignerRelay(s, ['wss://r'], fake).start([mag.pubkeyHex])
    expect(opts?.since).toBeGreaterThan(Math.floor(Date.now() / 1000) - 700)
  })

  it('uses the persisted replay store to suppress a request after a new relay instance starts', async () => {
    const s = signerFromMnemonic(M, ['magazine'], { approve: async () => true })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    const reqEv = await signReq(clientSk, mag.pubkeyHex, { id: '1', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'hi' })] })

    const seen = new Set<string>()
    const replayStore = {
      async has(id: string) {
        return seen.has(id)
      },
      async remember(id: string) {
        const duplicate = seen.has(id)
        seen.add(id)
        return duplicate
      },
    }

    let firstOnEvent: ((e: NostrEvent) => void | Promise<void>) | null = null
    let secondOnEvent: ((e: NostrEvent) => void | Promise<void>) | null = null
    const published: NostrEvent[] = []
    const firstPool: RelayPool = { subscribe(_r, _p, cb) { firstOnEvent = cb; return { close() {} } }, publish(_r, ev) { published.push(ev) }, close() {} }
    const secondPool: RelayPool = { subscribe(_r, _p, cb) { secondOnEvent = cb; return { close() {} } }, publish(_r, ev) { published.push(ev) }, close() {} }

    new SignerRelay(s, ['wss://r'], firstPool, replayStore).start([mag.pubkeyHex])
    await firstOnEvent!(reqEv)
    new SignerRelay(s, ['wss://r'], secondPool, replayStore).start([mag.pubkeyHex])
    await secondOnEvent!(reqEv)

    expect(published).toHaveLength(1)
  })
})

describe('SignerRelay.reconnectNow with the real backoff pool (M1 fast reconnect)', () => {
  afterEach(() => vi.useRealTimers())

  /** A fake nostr-tools-like pool: records subscribeMany calls, force-closes, and lets the test
   *  fire onclose. */
  function fakeNostrPool() {
    const subs: { relays: string[]; onclose?: (r: string[]) => void; closed: boolean }[] = []
    const closedUrls: string[][] = []
    const pool: PoolLike = {
      subscribeMany(relays, _filter, params) {
        const sub = { relays, onclose: params.onclose, closed: false }
        subs.push(sub)
        return { close() { sub.closed = true } }
      },
      publish() { return [] },
      close(relays) { closedUrls.push(relays) },
      destroy() {},
    }
    return { pool, subs, closedUrls }
  }

  it('reconnectNow() re-subscribes immediately and cancels the pending backoff timer, instead of waiting it out', () => {
    vi.useFakeTimers()
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const { pool, subs } = fakeNostrPool()
    const relay = new SignerRelay(s, ['wss://a'], wrapSimplePool(pool))
    relay.start([mag.pubkeyHex])
    expect(subs).toHaveLength(1)

    // The socket drops: a re-subscribe is scheduled after the (up to 60s) backoff.
    subs[0].onclose?.(['relay connection closed'])
    expect(subs).toHaveLength(1) // not yet

    // The app comes back to the foreground: reconnect immediately, without waiting.
    relay.reconnectNow()
    expect(subs).toHaveLength(2)
    expect(subs[1].relays).toEqual(['wss://a'])

    // The backoff timer that was pending before reconnectNow() must not also fire later and
    // produce a stray extra subscription.
    vi.advanceTimersByTime(120_000)
    expect(subs).toHaveLength(2)
  })

  // L3: nostr-tools' ensureRelay/connect() returns the existing connectionPromise for a URL, so a
  // plain re-subscribe can land on a half-open (still "connecting"/"connected" per the pool, but
  // dead) socket after e.g. a phone wakes from sleep. reconnectNow() must force-close first.
  it('reconnectNow() force-closes the existing socket for each relay before re-subscribing', () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const { pool, subs, closedUrls } = fakeNostrPool()
    const relay = new SignerRelay(s, ['wss://a', 'wss://b'], wrapSimplePool(pool))
    relay.start([mag.pubkeyHex])
    expect(subs).toHaveLength(2) // wss://a and wss://b, subscribed separately
    expect(closedUrls).toHaveLength(0)

    relay.reconnectNow()

    // The pool's underlying connection for each relay was force-closed BEFORE the new subscribe,
    // so the next subscribe can never reuse a cached dead connection.
    expect(closedUrls).toHaveLength(1)
    expect(closedUrls[0].sort()).toEqual(['wss://a', 'wss://b'])
    expect(subs).toHaveLength(4) // 2 more: wss://a and wss://b re-subscribed
  })
})
