import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { ProfileMetadata } from '../../app/db.js'
import { parseKind0Content } from './profile-metadata.js'

/** Fetch the freshest kind-0 event matching `filter` from the relays, or null. Injectable so the
 *  surrounding logic is unit-testable; the default runs a short one-shot query over a SimplePool. */
export type GetEvent = (relays: string[], filter: Filter) => Promise<NostrEvent | null>

const defaultGetEvent: GetEvent = (relays, filter) => {
  const pool = new SimplePool()
  return new Promise<NostrEvent | null>(resolve => {
    let best: NostrEvent | null = null
    let done = false
    const finish = () => {
      if (done) return
      done = true
      try { sub.close() } catch { /* already closed */ }
      pool.close(relays)
      resolve(best)
    }
    const sub = pool.subscribeMany(relays, filter, {
      onevent: (e) => { if (!best || e.created_at > best.created_at) best = e },
      oneose: () => finish(),
    })
    setTimeout(finish, 3500)
  })
}

/** Collect every kind-0 event matching `filter` from the relays. Injectable for tests; the default
 *  runs one short SimplePool query and resolves on EOSE or a 3.5s cap. */
export type GetEvents = (relays: string[], filter: Filter) => Promise<NostrEvent[]>

const defaultGetEvents: GetEvents = (relays, filter) => {
  const pool = new SimplePool()
  return new Promise<NostrEvent[]>(resolve => {
    const events: NostrEvent[] = []
    let done = false
    const finish = () => {
      if (done) return
      done = true
      try { sub.close() } catch { /* already closed */ }
      pool.close(relays)
      resolve(events)
    }
    const sub = pool.subscribeMany(relays, filter, {
      onevent: (e) => { events.push(e) },
      oneose: () => finish(),
    })
    setTimeout(finish, 3500)
  })
}

/** Fetch the newest kind-0 per author in one query. Returns a map keyed by pubkey hex; authors with
 *  no profile are omitted. An empty author list does no query. */
export async function fetchKind0Many(
  relays: string[],
  pubkeyHexes: string[],
  getEvents: GetEvents = defaultGetEvents,
): Promise<Map<string, { metadata: ProfileMetadata; raw: Record<string, unknown> }>> {
  const out = new Map<string, { metadata: ProfileMetadata; raw: Record<string, unknown> }>()
  if (pubkeyHexes.length === 0) return out
  const events = await getEvents(relays, { kinds: [0], authors: pubkeyHexes })
  const newest = new Map<string, NostrEvent>()
  for (const e of events) {
    const cur = newest.get(e.pubkey)
    if (!cur || e.created_at > cur.created_at) newest.set(e.pubkey, e)
  }
  for (const [pk, e] of newest) out.set(pk, parseKind0Content(e.content))
  return out
}

/** Load an identity's existing profile from its relays so the editor can pre-fill (and so a later
 *  republish preserves fields Lite doesn't manage). Returns null when nothing is found. */
export async function fetchKind0(
  relays: string[],
  pubkeyHex: string,
  getEvent: GetEvent = defaultGetEvent,
): Promise<{ metadata: ProfileMetadata; raw: Record<string, unknown> } | null> {
  const event = await getEvent(relays, { kinds: [0], authors: [pubkeyHex], limit: 1 })
  if (!event) return null
  return parseKind0Content(event.content)
}
