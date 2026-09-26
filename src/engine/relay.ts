import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools'
import type { Filter } from 'nostr-tools'
import type { Signer } from './signer.js'
import { NIP46_REQUEST_MAX_AGE_SECONDS } from './nip46.js'
import { isValidRelayUrl } from './relay-url.js'

/** Minimal relay-pool surface SignerRelay needs — injectable so the wiring is unit-testable. */
export interface RelaySubscribeOptions { since?: number }
export interface RelayPool {
  subscribe(relays: string[], identityPubkeys: string[], onEvent: (e: NostrEvent) => void | Promise<void>, opts?: RelaySubscribeOptions): { close(): void }
  publish(relays: string[], event: NostrEvent): void
  close(): void
  /** Force-close the underlying connection for each of these relay URLs (distinct from a
   *  subscription's own close()), so a following subscribe() can never land on a cached
   *  half-open/dead socket (L3). Optional: a pool that doesn't implement it just keeps the old
   *  reconnectNow() behaviour. */
  closeRelays?(relays: string[]): void
}

export interface RequestReplayStore {
  /** Check a previously handled event id without inserting a new record. */
  has?(eventId: string, seenAtSeconds: number): Promise<boolean>
  /** Claim an event id. Returns true when it has already been seen (claimed by someone else). */
  remember(eventId: string, seenAtSeconds: number): Promise<boolean>
}

/** Keep only well-formed ws(s) relay URLs (a malformed one makes the pool throw synchronously),
 *  de-duplicated, order preserved. Never throws. */
function sanitizeRelays(relays: string[]): string[] {
  const out: string[] = []
  for (const r of relays) {
    if (typeof r === 'string' && isValidRelayUrl(r) && !out.includes(r)) out.push(r)
  }
  return out
}

/** Routes inbound kind-24133 requests to the Signer and publishes its (already-encrypted) responses. */
export class SignerRelay {
  private sub: { close(): void } | null = null
  private lastPubkeys: string[] = []
  private relays: string[]
  /** Set by stop(): nothing is published after a lock (late responses, ack re-publish timers). */
  private stopped = false
  /** A pool close deferred by stop() so lock-time denials can reach the relays first. */
  private closeTimer: ReturnType<typeof setTimeout> | null = null
  /** Request event ids already handled. Relays may re-deliver an event (multiple relays, stored
   *  replay, reconnects); a signer must be idempotent so it never signs — or logs — twice. Bounded
   *  FIFO so a long-lived session can't leak memory. Survives re-subscription. Only decrypted,
   *  relevant requests are marked handled, so unauthenticated relay spam cannot evict real ids. */
  private seen = new Set<string>()
  private inFlight = new Set<string>()
  private static readonly SEEN_CAP = 4096
  /** How long stop() keeps the pool open after publishing lock-time denials. */
  private static readonly DENIAL_FLUSH_MS = 3000
  constructor(private signer: Signer, relays: string[], private pool: RelayPool, private replayStore?: RequestReplayStore) {
    this.relays = sanitizeRelays(relays)
  }

  start(identityPubkeys: string[]): void {
    this.stopped = false
    if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null }
    this.subscribe(identityPubkeys)
  }

  /** Open the new subscription BEFORE closing the old one, so a pool that throws (or any other
   *  failure) leaves the signer listening on its previous subscription. Never throws. */
  private subscribe(identityPubkeys: string[]): boolean {
    const since = Math.floor(Date.now() / 1000) - NIP46_REQUEST_MAX_AGE_SECONDS
    let next: { close(): void }
    try {
      next = this.pool.subscribe(this.relays, identityPubkeys, (event) => this.onRequest(event), { since })
    } catch {
      return false
    }
    this.lastPubkeys = identityPubkeys
    const prev = this.sub
    this.sub = next
    try { prev?.close() } catch { /* the old subscription is gone either way */ }
    return true
  }

  private async onRequest(event: NostrEvent): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    // Claim event.id synchronously (before any await) so a second, near-simultaneous delivery
    // of the same event sees it in inFlight rather than racing past this check while the first
    // call is still awaiting the replay-store lookup below.
    if (this.hasHandled(event.id) || this.inFlight.has(event.id)) return
    this.inFlight.add(event.id)
    try {
      if (this.replayStore?.has && await this.replayStore.has(event.id, now)) {
        this.markHandled(event.id)
        return
      }
      // The signer calls claim() once the request is authentic and authorised, BEFORE prompting
      // or signing: the persisted replay entry is written first, so another tab (or a replay after
      // a crash) cannot handle it again. If handling fails after the claim, it stays claimed.
      let claimed = false
      const claim = async (): Promise<boolean> => {
        claimed = true
        this.markHandled(event.id)
        if (!this.replayStore) return true
        return !(await this.replayStore.remember(event.id, now))
      }
      const resp = await this.signer.handleRequestEvent(event, { claim })
      if (!resp) return
      if (!claimed) {
        // A signer that never called claim(): fall back to remembering after handling.
        this.markHandled(event.id)
        if (this.replayStore && await this.replayStore.remember(event.id, now)) return
      }
      if (this.stopped) return
      this.pool.publish(this.relays, resp)
    } catch {
      // Drop: a failing request (e.g. the session locked mid-request) is never retried — it may
      // already be claimed — and must not surface as an unhandled rejection.
    } finally {
      this.inFlight.delete(event.id)
    }
  }

  private hasHandled(id: string): boolean {
    return this.seen.has(id)
  }

  /** Record an event id after it produced a response. */
  private markHandled(id: string): void {
    this.seen.add(id)
    if (this.seen.size > SignerRelay.SEEN_CAP) {
      const oldest = this.seen.values().next().value
      if (oldest !== undefined) this.seen.delete(oldest)
    }
  }
  /** Force an immediate reconnect/resubscribe instead of waiting out the pool's own backoff — for
   *  a foreground/online signal (visibilitychange→visible, window 'online') after the device was
   *  asleep or offline. A fresh subscribe() opens new sockets and, once they're up, closes the old
   *  subscription, which cancels any backoff timer still pending on it (M1). A no-op before start()
   *  or after stop(), so it never resurrects a locked session. Force-closes the pool's existing
   *  connections for the current relays first (L3): nostr-tools' ensureRelay()/connect() return
   *  the existing connectionPromise for a URL, so a plain re-subscribe can land on a half-open
   *  (still "connecting"/"connected" per the pool, but dead) socket rather than a fresh one — the
   *  most common case after a phone wakes from sleep. */
  reconnectNow(): void {
    if (this.stopped || !this.sub) return
    try { this.pool.closeRelays?.(this.relays) } catch { /* best effort */ }
    this.subscribe(this.lastPubkeys)
  }

  /** Re-subscribe to an updated identity list on an already-live relay (add/remove identity). A
   *  no-op before start() or once stopped, so a lock()/stop() that lands while the caller is still
   *  awaiting (e.g. the db write in addIdentityLive/removeIdentityLive) can never revive a locked
   *  session's sockets (L2). Unlike this, start() itself remains the genuine restart path — it is
   *  only ever called on a freshly constructed relay or a deliberately reused one. */
  resubscribe(identityPubkeys: string[]): void {
    if (this.stopped || !this.sub) return
    this.subscribe(identityPubkeys)
  }

  /** Re-point to a new relay set and re-subscribe (if active) to the same identities. Invalid URLs
   *  are dropped; if re-subscribing fails, the previous relay set and subscription are kept. */
  setRelays(relays: string[]): void {
    const prev = this.relays
    this.relays = sanitizeRelays(relays)
    if (this.sub && !this.subscribe(this.lastPubkeys)) this.relays = prev
  }
  stop(): void {
    this.stopped = true
    const sub = this.sub
    this.sub = null
    try { sub?.close() } catch { /* closing anyway */ }
    // Deny any prompt still open while the keys are live, and give the denials a moment to reach
    // the relays before the sockets close.
    let denials: NostrEvent[] = []
    try { denials = this.signer.settlePendingApprovals?.() ?? [] } catch { /* none */ }
    if (denials.length === 0) { this.pool.close(); return }
    for (const d of denials) {
      try { this.pool.publish(this.relays, d) } catch { /* best effort */ }
    }
    if (this.closeTimer) clearTimeout(this.closeTimer)
    this.closeTimer = setTimeout(() => { this.closeTimer = null; this.pool.close() }, SignerRelay.DENIAL_FLUSH_MS)
  }
  /** Publish an already-built event (e.g. a pairing ack from Signer.pair) to the configured relays.
   *  A no-op after stop(), so late timers cannot reopen sockets on a locked session. */
  publish(event: NostrEvent): void {
    if (this.stopped) return
    this.pool.publish(this.relays, event)
  }
}

/** The subset of nostr-tools' SimplePool that {@link wrapSimplePool} uses. */
export interface PoolLike {
  subscribeMany(relays: string[], filter: Filter, params: {
    onevent: (e: NostrEvent) => void
    oneose?: () => void
    onclose?: (reasons: string[]) => void
  }): { close(): void }
  publish(relays: string[], event: NostrEvent): Promise<string>[]
  /** Force-close the underlying connection for each of these relay URLs (nostr-tools'
   *  AbstractSimplePool.close(relays)) — distinct from destroy(), which tears down everything. */
  close(relays: string[]): void
  destroy(): void
}

/** Delay before re-subscribing a dropped relay, by consecutive failure count. */
const RESUBSCRIBE_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000]

/**
 * Adapt a nostr-tools pool to {@link RelayPool}, with two robustness guarantees:
 *  - each relay is subscribed separately, so one URL the pool rejects is dropped instead of
 *    throwing for the whole set;
 *  - when a relay's subscription closes without us asking (socket drop, failed connect, relay
 *    CLOSED), it is re-subscribed with backoff and a refreshed `since`, until closed by the caller.
 */
export function wrapSimplePool(pool: PoolLike): RelayPool {
  const live = new Set<() => void>()
  return {
    subscribe(relays, identityPubkeys, onEvent, opts) {
      const windowSec = opts?.since !== undefined ? Math.floor(Date.now() / 1000) - opts.since : undefined
      let closed = false
      type RelayState = { sub: { close(): void } | null; timer: ReturnType<typeof setTimeout> | null; attempts: number; token: object | null }
      const states: RelayState[] = []

      const open = (url: string, st: RelayState, first: boolean): boolean => {
        if (closed) return false
        const since = windowSec === undefined ? undefined : first ? opts!.since! : Math.floor(Date.now() / 1000) - windowSec
        const filter: Filter = { kinds: [24133], '#p': identityPubkeys, ...(since !== undefined ? { since } : {}) }
        const token = {}
        st.token = token
        const onclose = () => {
          if (closed || st.token !== token) return // closed by us, or a stale subscription
          st.token = null
          st.sub = null
          const delay = RESUBSCRIBE_BACKOFF_MS[Math.min(st.attempts, RESUBSCRIBE_BACKOFF_MS.length - 1)]
          st.attempts++
          st.timer = setTimeout(() => { st.timer = null; open(url, st, false) }, delay)
        }
        let sub: { close(): void }
        try {
          sub = pool.subscribeMany([url], filter, {
            onevent: (e) => {
              try { void Promise.resolve(onEvent(e)).catch(() => {}) } catch { /* handler errors never reach the pool */ }
            },
            oneose: () => { if (st.token === token) st.attempts = 0 },
            onclose,
          })
        } catch {
          if (st.token === token) st.token = null
          return false // a URL the pool rejects: drop it, never retry
        }
        if (st.token === token) st.sub = sub
        return true
      }

      for (const url of [...new Set(relays)]) {
        const st: RelayState = { sub: null, timer: null, attempts: 0, token: null }
        states.push(st)
        open(url, st, true)
      }

      const close = () => {
        if (closed) return
        closed = true
        live.delete(close)
        for (const st of states) {
          if (st.timer) { clearTimeout(st.timer); st.timer = null }
          const sub = st.sub
          st.sub = null
          st.token = null
          try { sub?.close() } catch { /* already gone */ }
        }
      }
      live.add(close)
      return { close }
    },
    publish(relays, event) {
      for (const url of [...new Set(relays)]) {
        try { void Promise.allSettled(pool.publish([url], event)) } catch { /* a URL the pool rejects */ }
      }
    },
    close() {
      for (const c of [...live]) c()
      pool.destroy()
    },
    closeRelays(relays) {
      // Force-close the pool's underlying connection for each URL (L3), so the caller's following
      // subscribe() can never reuse a cached half-open/dead socket. This does not touch our own
      // subscription bookkeeping (`live`/backoff state) — the caller re-subscribes right after.
      try { pool.close([...new Set(relays)]) } catch { /* best effort */ }
    },
  }
}

/** Production RelayPool backed by nostr-tools SimplePool (with keep-alive pings, so a dead socket
 *  is noticed and re-subscribed). */
export function createSimplePool(): RelayPool {
  return wrapSimplePool(new SimplePool({ enablePing: true }))
}
