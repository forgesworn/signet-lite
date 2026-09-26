import { parseNostrConnectURI, type NostrConnectRequest } from '../engine/nip46.js'
import { putApp, getApp } from '../app/db.js'
import { loadSessionRelays } from './relays-edit.js'
import type { AppPolicies } from '../app/db.js'
import type { Session } from '../app/session.js'

/** Delays (ms after pairing) at which the connect ack is re-published. The nostrconnect ack is an
 *  ephemeral kind-24133 event: relays fan it out to whoever is subscribed at that instant and never
 *  store it, so a client that isn't listening when we publish misses it for good. The common failure
 *  is the two-tab dance: the app (e.g. noStrudel) waits in one browser tab while the user switches to
 *  Lite in another to paste the link. Safari (and others) suspend background tabs — freezing the app's
 *  relay socket — so it misses the ack, and by the time the user switches back and its socket
 *  reconnects, an ~8s retry window is long gone. Re-publishing the SAME signed ack on a decaying
 *  schedule out to ~2 minutes keeps it in flight until the app's tab returns to the foreground and
 *  re-subscribes; a client that already connected simply ignores the duplicate acks. (Verified
 *  2026-06-23: relay.nsec.app re-delivers the identical ephemeral event id on every re-publish.) */
export const ACK_REPUBLISH_DELAYS_MS = [1000, 2500, 5000, 8000, 12000, 18000, 25000, 35000, 50000, 65000, 85000, 105000, 120000]

/** Schedules a callback after `delayMs`. Injectable so tests drive the re-publishes deterministically. */
export type Scheduler = (cb: () => void, delayMs: number) => void
const defaultScheduler: Scheduler = (cb, delayMs) => { setTimeout(cb, delayMs) }

/** A human label for a connecting app. Uses the parsed request's appName field if it is
 *  a real name (not the 'Unknown App' default), else falls back to a truncated client pubkey. */
export function appNameFromUri(req: NostrConnectRequest): string {
  // 'Unknown App' is the sentinel nip46.ts assigns when no app-provided name is present — intentional coupling.
  if (req.appName && req.appName !== 'Unknown App') return req.appName
  return `App ${req.clientPubkey.slice(0, 8)}`
}

/** Pair with a nostrconnect app: validate, ensure Lite listens on the URI's relay(s),
 *  pair, publish the ack to the union relay set, and persist with auto-trust policy. */
export async function connectApp(opts: {
  session: Session
  uri: string
  identityName: string
  /** When true (the default), the app is added with per-request prompts instead of auto-trust. */
  askEachTime?: boolean
  /** Scheduler for the ack re-publishes. Defaults to setTimeout; tests inject a capturing stub. */
  schedule?: Scheduler
}): Promise<{ clientPubkey: string; appName: string }> {
  const req = parseNostrConnectURI(opts.uri)
  if (!req) throw new Error('invalid nostrconnect URI')
  const appName = appNameFromUri(req)
  // The connecting app listens on the relay(s) in its URI. Union those with the user's relays and
  // every other paired app's relays (M1), so Lite publishes the ack where this app expects it
  // without going deaf to apps paired earlier on their own relays.
  const base = await loadSessionRelays()
  const relays = Array.from(new Set([...base, ...req.relayUrls]))
  opts.session.relay.setRelays(relays)
  const existing = await getApp(opts.identityName, req.clientPubkey)
  const { clientPubkey, connectResponse } = await opts.session.signer.pair(opts.uri, opts.identityName)
  const askEachTime = opts.askEachTime ?? true
  const policies: AppPolicies = askEachTime
    ? { sign: 'ask', dm: 'ask', profile: 'ask' }
    : { sign: 'always', dm: 'always', profile: 'decline' }
  const connectedAt = Math.floor(Date.now() / 1000)
  try {
    // Re-pairing an app that is already connected (L10) keeps the user's label and per-kind
    // overrides, and refreshes what the link itself supplies (name, URL, relays). The Ask-each-time
    // / Auto-trust choice made on the connect screen is an explicit re-decision, not ignored: it
    // replaces the app's category-level policies (sign/dm/profile) same as for a new app.
    await putApp(existing
      ? { ...existing, appName, appUrl: req.appUrl ?? existing.appUrl, relays: req.relayUrls, connectedAt, policies }
      : { clientPubkey, identityName: opts.identityName, appName, appUrl: req.appUrl, relays: req.relayUrls, policies, connectedAt })
  } catch (err) {
    // Only drop the authorisation this pairing created; an app that was already connected keeps it.
    if (!existing) opts.session.signer.revokeForIdentity(opts.identityName, clientPubkey)
    throw err
  }
  // Publish the ack immediately, then re-publish on a decaying schedule. The re-publishes bridge
  // brief subscription gaps on flaky relays (see ACK_REPUBLISH_DELAYS_MS); an app that has already
  // connected ignores the duplicates. Each re-publish is wrapped so a torn-down relay (the user
  // locked Lite before the timers fired) can't raise an unhandled rejection.
  opts.session.publish(connectResponse)
  const schedule = opts.schedule ?? defaultScheduler
  for (const delay of ACK_REPUBLISH_DELAYS_MS) {
    schedule(() => { try { opts.session.publish(connectResponse) } catch { /* relay closed on lock — ignore */ } }, delay)
  }
  return { clientPubkey, appName }
}
