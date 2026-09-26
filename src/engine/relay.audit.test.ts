// Regression tests for the engine-layer audit findings on the relay wiring (H2, H4, L1, L5, L6).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { SignerRelay, wrapSimplePool, type RelayPool, type PoolLike } from './relay.js'
import { signerFromMnemonic } from './signer.js'
import { deriveIdentity } from './derive.js'
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools'
import { bytesToHex } from 'nostr-tools/utils'
import { nip44Encrypt, nip44Decrypt } from './nip46.js'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
type OnEvent = (e: NostrEvent) => void | Promise<void>

async function signReq(clientSk: Uint8Array, idPubHex: string, body: object): Promise<NostrEvent> {
  const content = await nip44Encrypt(bytesToHex(clientSk), idPubHex, JSON.stringify(body))
  return finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', idPubHex]], content }, clientSk)
}

const signBody = (id = '1') => ({ id, method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'hi' })] })

/** A paired signer + a fake pool that records everything. */
async function setup(approve: () => Promise<boolean>) {
  const s = signerFromMnemonic(M, ['magazine'], { approve })
  const mag = deriveIdentity(M, 'magazine')
  const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
  await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
  const log: string[] = []
  const published: NostrEvent[] = []
  const subs: { relays: string[]; cb: OnEvent; closed: boolean }[] = []
  const pool: RelayPool = {
    subscribe(relays, _pks, cb) {
      const sub = { relays, cb, closed: false }
      subs.push(sub)
      return { close() { sub.closed = true } }
    },
    publish(_r, ev) { log.push('publish'); published.push(ev) },
    close() { log.push('close') },
  }
  return { s, mag, clientSk, clientPub, pool, log, published, subs }
}

const flush = () => new Promise(r => setTimeout(r, 0))

afterEach(() => { vi.useRealTimers() })

describe('H2: SignerRelay never lets a bad relay URL throw or kill listening', () => {
  it('drops invalid relay URLs instead of handing them to the pool', async () => {
    const { s, mag, pool, subs } = await setup(async () => true)
    const relay = new SignerRelay(s, ['wss://', 'wss://ok', 'wss://%zz', 'wss://a b'], pool)
    expect(() => relay.start([mag.pubkeyHex])).not.toThrow()
    expect(subs[0].relays).toEqual(['wss://ok'])
    expect(() => relay.setRelays(['wss://relay damus.io', 'wss://ok2'])).not.toThrow()
    expect(subs[1].relays).toEqual(['wss://ok2'])
  })

  it('keeps the live subscription when re-subscribing throws synchronously', async () => {
    const { s, mag, clientSk, pool, published, subs } = await setup(async () => true)
    let calls = 0
    const throwing: RelayPool = {
      ...pool,
      subscribe(relays, pks, cb, o) {
        if (++calls > 1) throw new Error('Invalid URL')
        return pool.subscribe(relays, pks, cb, o)
      },
    }
    const relay = new SignerRelay(s, ['wss://a'], throwing)
    relay.start([mag.pubkeyHex])
    expect(() => relay.setRelays(['wss://b'])).not.toThrow()
    expect(subs[0].closed).toBe(false) // the old subscription was not torn down
    await subs[0].cb(await signReq(clientSk, mag.pubkeyHex, signBody()))
    expect(published).toHaveLength(1) // still listening
  })

  it('opens the new subscription before closing the old one', async () => {
    const { s, mag, pool, subs } = await setup(async () => true)
    const order: string[] = []
    const tracking: RelayPool = {
      ...pool,
      subscribe(relays, pks, cb, o) {
        order.push(`open:${relays.join(',')}`)
        const inner = pool.subscribe(relays, pks, cb, o)
        return { close() { order.push(`close:${relays.join(',')}`); inner.close() } }
      },
    }
    const relay = new SignerRelay(s, ['wss://a'], tracking)
    relay.start([mag.pubkeyHex])
    relay.setRelays(['wss://b'])
    expect(order).toEqual(['open:wss://a', 'open:wss://b', 'close:wss://a'])
    expect(subs).toHaveLength(2)
  })
})

/** A fake nostr-tools-like pool: records subscribeMany calls and lets the test fire onclose/oneose. */
function fakeNostrPool(opts: { throwFor?: string[] } = {}) {
  const subs: { relays: string[]; filter: { since?: number }; params: { onevent: OnEvent; oneose?: () => void; onclose?: (r: string[]) => void }; closed: boolean }[] = []
  let destroyed = 0
  const pool: PoolLike = {
    subscribeMany(relays, filter, params) {
      for (const r of relays) if (opts.throwFor?.includes(r)) throw new Error(`Invalid URL: ${r}`)
      const sub = { relays, filter, params, closed: false }
      subs.push(sub)
      return {
        close() {
          sub.closed = true
          params.onclose?.(relays.map(() => 'closed by caller'))
        },
      }
    },
    publish() { return [] },
    close() {},
    destroy() { destroyed++ },
  }
  return { pool, subs, destroyed: () => destroyed }
}

describe('H2: createSimplePool subscription is robust to one bad URL', () => {
  it('subscribes to the good relays when one URL makes the pool throw', () => {
    const f = fakeNostrPool({ throwFor: ['wss://bad'] })
    const rp = wrapSimplePool(f.pool)
    expect(() => rp.subscribe(['wss://a', 'wss://bad', 'wss://b'], ['pk'], () => {})).not.toThrow()
    expect(f.subs.map(s => s.relays)).toEqual([['wss://a'], ['wss://b']])
  })
})

describe('H4: createSimplePool re-subscribes after a socket drop', () => {
  it('re-subscribes a dropped relay after a backoff, with a refreshed since', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000_000)
    const f = fakeNostrPool()
    const rp = wrapSimplePool(f.pool)
    const since = Math.floor(Date.now() / 1000) - 600
    rp.subscribe(['wss://a', 'wss://b'], ['pk'], () => {}, { since })
    expect(f.subs).toHaveLength(2)
    // relay a's socket drops
    f.subs[0].params.onclose?.(['relay connection closed'])
    expect(f.subs).toHaveLength(2) // not immediately
    vi.advanceTimersByTime(60_000)
    expect(f.subs).toHaveLength(3)
    expect(f.subs[2].relays).toEqual(['wss://a'])
    // since is recomputed at re-subscribe time: same 600 s window, moved forward
    expect(f.subs[2].filter.since).toBeGreaterThan(since)
    expect(f.subs[2].filter.since).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) - 600)
  })

  it('backs off progressively while a relay keeps failing, and resets after EOSE', () => {
    vi.useFakeTimers()
    const f = fakeNostrPool()
    const rp = wrapSimplePool(f.pool)
    rp.subscribe(['wss://a'], ['pk'], () => {})
    const delays: number[] = []
    for (let i = 0; i < 4; i++) {
      const before = f.subs.length
      f.subs[f.subs.length - 1].params.onclose?.(['relay connection failed'])
      let waited = 0
      while (f.subs.length === before && waited < 120_000) { vi.advanceTimersByTime(250); waited += 250 }
      delays.push(waited)
    }
    expect(delays[0]).toBeGreaterThan(0)
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1])
    expect(delays[3]).toBeGreaterThan(delays[0])
    // a successful (re)subscription resets the backoff
    f.subs[f.subs.length - 1].params.oneose?.()
    const before = f.subs.length
    f.subs[f.subs.length - 1].params.onclose?.(['relay connection closed'])
    let waited = 0
    while (f.subs.length === before && waited < 120_000) { vi.advanceTimersByTime(250); waited += 250 }
    expect(waited).toBe(delays[0])
  })

  it('does not re-subscribe after the caller closes the subscription', () => {
    vi.useFakeTimers()
    const f = fakeNostrPool()
    const rp = wrapSimplePool(f.pool)
    const sub = rp.subscribe(['wss://a'], ['pk'], () => {})
    f.subs[0].params.onclose?.(['relay connection closed']) // a drop schedules a retry…
    sub.close() // …which closing cancels
    vi.advanceTimersByTime(600_000)
    expect(f.subs).toHaveLength(1)
  })

  it('does not re-subscribe after the pool is closed (lock)', () => {
    vi.useFakeTimers()
    const f = fakeNostrPool()
    const rp = wrapSimplePool(f.pool)
    rp.subscribe(['wss://a'], ['pk'], () => {})
    f.subs[0].params.onclose?.(['relay connection closed'])
    rp.close()
    f.subs[0].params.onclose?.(['relay connection closed by us'])
    vi.advanceTimersByTime(600_000)
    expect(f.subs).toHaveLength(1)
    expect(f.destroyed()).toBe(1)
  })
})

describe('L1: locking while an approval is pending', () => {
  it('Signer.destroy() settles a pending approval as a quiet null, never wrapping with the zeroed key', async () => {
    const { s, mag, clientSk } = await setup(() => new Promise<boolean>(() => {})) // never answered
    const p = s.handleRequestEvent(await signReq(clientSk, mag.pubkeyHex, signBody()))
    await flush()
    s.destroy()
    await expect(p).resolves.toBeNull()
  })

  it('does not throw when the approval resolves (denied) just before destroy, as App.lock does', async () => {
    let answer!: (ok: boolean) => void
    const { s, mag, clientSk } = await setup(() => new Promise<boolean>(r => { answer = r }))
    const p = s.handleRequestEvent(await signReq(clientSk, mag.pubkeyHex, signBody()))
    await flush()
    answer(false) // approvalQueue.clear()
    s.destroy() // session.lock() in the same tick
    await expect(p).resolves.toBeNull()
  })

  it('does not throw when the approval resolves after the identity was removed', async () => {
    let answer!: (ok: boolean) => void
    const { s, mag, clientSk } = await setup(() => new Promise<boolean>(r => { answer = r }))
    const p = s.handleRequestEvent(await signReq(clientSk, mag.pubkeyHex, signBody()))
    await flush()
    s.removeIdentity('magazine')
    answer(true)
    await expect(p).resolves.toBeNull()
  })

  it('SignerRelay.stop() publishes a denial for the pending request before closing the pool', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { s, mag, clientSk, clientPub, pool, log, published, subs } = await setup(() => new Promise<boolean>(() => {}))
    const relay = new SignerRelay(s, ['wss://r'], pool)
    relay.start([mag.pubkeyHex])
    const handled = subs[0].cb(await signReq(clientSk, mag.pubkeyHex, signBody('42')))
    for (let i = 0; i < 5; i++) await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    relay.stop()
    s.destroy()
    await handled
    expect(published).toHaveLength(1)
    expect(verifyEvent(published[0])).toBe(true)
    const body = JSON.parse(await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, published[0].content))
    expect(body).toEqual({ id: '42', error: 'denied' })
    expect(published[0].tags).toEqual([['p', clientPub]])
    // the pool is closed only after the denial had a chance to go out
    expect(log[0]).toBe('publish')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(log).toEqual(['publish', 'close'])
  })

  it('a handler failure is swallowed (no unhandled rejection)', async () => {
    const fakeSigner = { async handleRequestEvent() { throw new Error('boom') } }
    let cb: OnEvent | null = null
    const pool: RelayPool = { subscribe(_r, _p, c) { cb = c; return { close() {} } }, publish() {}, close() {} }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new SignerRelay(fakeSigner as any, ['wss://r'], pool).start(['pk'])
    const ev = { id: 'e1', kind: 24133, pubkey: 'c', created_at: Math.floor(Date.now() / 1000), tags: [], content: 'x', sig: 'y' } as unknown as NostrEvent
    await expect(Promise.resolve(cb!(ev))).resolves.toBeUndefined()
  })
})

describe('L5: the replay-store entry is written before signing', () => {
  it('remembers the request before asking for approval', async () => {
    const order: string[] = []
    const { s, mag, clientSk, pool } = await setup(async () => { order.push('approve'); return true })
    const replayStore = {
      async has() { return false },
      async remember() { order.push('remember'); return false },
    }
    let cb: OnEvent | null = null
    const grab: RelayPool = { ...pool, subscribe(_r, _p, c) { cb = c; return { close() {} } }, publish() { order.push('publish') } }
    new SignerRelay(s, ['wss://r'], grab, replayStore).start([mag.pubkeyHex])
    await cb!(await signReq(clientSk, mag.pubkeyHex, signBody()))
    expect(order).toEqual(['remember', 'approve', 'publish'])
  })

  it('two tabs sharing a replay store prompt and sign only once', async () => {
    let approveCalls = 0
    const { s, mag, clientSk, pool, published } = await setup(async () => { approveCalls++; return true })
    const seen = new Set<string>()
    const replayStore = {
      async has(id: string) { return seen.has(id) },
      async remember(id: string) { const dup = seen.has(id); seen.add(id); return dup },
    }
    const cbs: OnEvent[] = []
    const grab: RelayPool = { ...pool, subscribe(_r, _p, c) { cbs.push(c); return { close() {} } } }
    new SignerRelay(s, ['wss://r'], grab, replayStore).start([mag.pubkeyHex])
    new SignerRelay(s, ['wss://r'], grab, replayStore).start([mag.pubkeyHex])
    const ev = await signReq(clientSk, mag.pubkeyHex, signBody())
    await Promise.all([cbs[0](ev), cbs[1](ev)]) // both pass has() before either remembers
    expect(approveCalls).toBe(1)
    expect(published).toHaveLength(1)
  })

  it('a request claimed but then failing is not re-handled on redelivery', async () => {
    let approveCalls = 0
    const { s, mag, clientSk, pool, published } = await setup(async () => { approveCalls++; throw new Error('prompt crashed') })
    const seen = new Set<string>()
    const replayStore = {
      async has(id: string) { return seen.has(id) },
      async remember(id: string) { const dup = seen.has(id); seen.add(id); return dup },
    }
    let cb: OnEvent | null = null
    new SignerRelay(s, ['wss://r'], { ...pool, subscribe(_r, _p, c) { cb = c; return { close() {} } } }, replayStore).start([mag.pubkeyHex])
    const ev = await signReq(clientSk, mag.pubkeyHex, signBody())
    await expect(Promise.resolve(cb!(ev))).resolves.toBeUndefined()
    await cb!(ev)
    expect(approveCalls).toBe(1)
    expect(published).toHaveLength(0)
    expect(seen.has(ev.id)).toBe(true)
  })
})

describe('L6: nothing is published after stop()', () => {
  it('publish() after stop() does not touch the pool (ack re-publish timers after lock)', async () => {
    const { s, pool, published } = await setup(async () => true)
    const relay = new SignerRelay(s, ['wss://r'], pool)
    relay.start([])
    relay.stop()
    relay.publish({ id: 'x', kind: 24133, pubkey: 'aa', created_at: 0, tags: [], content: 'c', sig: 's' } as unknown as NostrEvent)
    expect(published).toHaveLength(0)
  })

  it('a response that finishes after stop() is not published', async () => {
    let answer!: (ok: boolean) => void
    const { s, mag, clientSk, pool, published, subs } = await setup(() => new Promise<boolean>(r => { answer = r }))
    const relay = new SignerRelay(s, ['wss://r'], pool)
    relay.start([mag.pubkeyHex])
    const handled = subs[0].cb(await signReq(clientSk, mag.pubkeyHex, signBody()))
    await flush()
    // Simulate a stop() that races ahead of the approval continuation but leaves keys intact
    // (e.g. relay torn down for a relay-set change on a stopped instance).
    relay['stopped'] = true
    answer(true)
    await handled
    expect(published).toHaveLength(0)
  })

  it('start() after stop() re-enables publishing', async () => {
    const { s, pool, published } = await setup(async () => true)
    const relay = new SignerRelay(s, ['wss://r'], pool)
    relay.start([])
    relay.stop()
    relay.start([])
    relay.publish({ id: 'x', kind: 24133, pubkey: 'aa', created_at: 0, tags: [], content: 'c', sig: 's' } as unknown as NostrEvent)
    expect(published).toHaveLength(1)
  })
})
