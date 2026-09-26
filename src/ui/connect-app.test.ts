import { describe, it, expect, beforeEach } from 'vitest'
import { connectApp, appNameFromUri, ACK_REPUBLISH_DELAYS_MS } from './connect-app.js'
import { parseNostrConnectURI } from '../engine/nip46.js'
import { createSession } from '../app/session.js'
import { getApp, putApp, __resetDbForTests } from '../app/db.js'
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools'
import type { RelayPool } from '../engine/relay.js'
import { deleteDB } from 'idb'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/** Fake RelayPool that records which relay sets have been subscribed and collects published events. */
function makeFakePool(published: NostrEvent[]): { pool: RelayPool; subscribedRelays: string[][] } {
  const subscribedRelays: string[][] = []
  const pool: RelayPool = {
    subscribe(relays, _pubkeys, _onEvent) {
      subscribedRelays.push([...relays])
      return { close() {} }
    },
    publish(_relays, event) { published.push(event) },
    close() {},
  }
  return { pool, subscribedRelays }
}

describe('connectApp', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('pairs, persists the app ask-first by default, publishes the ack, and re-subscribes to the union relay set', async () => {
    const published: NostrEvent[] = []
    const { pool, subscribedRelays } = makeFakePool(published)
    const session = createSession({
      mnemonic: M,
      identityNames: ['magazine'],
      relays: ['wss://relay.damus.io', 'wss://nos.lol'],
      approve: async () => true,
      pool,
    })

    const clientPub = getPublicKey(generateSecretKey())
    // The URI uses wss://relay.nsec.app — a relay NOT in the session's initial relay set
    const uri = `nostrconnect://${clientPub}?relay=wss%3A%2F%2Frelay.nsec.app&secret=sek`

    const res = await connectApp({ session, uri, identityName: 'magazine', schedule: () => {} })

    expect(res.clientPubkey).toBe(clientPub)
    // The ack must have been published
    expect(published.length).toBeGreaterThanOrEqual(1)
    expect(verifyEvent(published[0])).toBe(true)

    // After connectApp, the relay was re-subscribed to a set that INCLUDES the URI's relay
    const lastSubscribed = subscribedRelays[subscribedRelays.length - 1]
    expect(lastSubscribed).toContain('wss://relay.nsec.app')
    // …and still includes the user's own relays (union)
    expect(lastSubscribed).toContain('wss://relay.damus.io')

    // App persisted ask-first by default.
    const app = await getApp('magazine', clientPub)
    expect(app?.policies).toEqual({ sign: 'ask', dm: 'ask', profile: 'ask' })
    expect(app?.identityName).toBe('magazine')

    session.lock()
  })

  it('persists ask for all categories when askEachTime is set', async () => {
    const published: NostrEvent[] = []
    const { pool } = makeFakePool(published)
    const session = createSession({
      mnemonic: M,
      identityNames: ['magazine'],
      relays: ['wss://nos.lol'],
      approve: async () => true,
      pool,
    })
    const clientPub = getPublicKey(generateSecretKey())
    const uri = `nostrconnect://${clientPub}?relay=wss%3A%2F%2Frelay.nsec.app&secret=sek`

    await connectApp({ session, uri, identityName: 'magazine', askEachTime: true, schedule: () => {} })

    const app = await getApp('magazine', clientPub)
    expect(app?.policies).toEqual({ sign: 'ask', dm: 'ask', profile: 'ask' })

    session.lock()
  })

  it('can still persist a trusted app when askEachTime is explicitly disabled', async () => {
    const published: NostrEvent[] = []
    const { pool } = makeFakePool(published)
    const session = createSession({
      mnemonic: M,
      identityNames: ['magazine'],
      relays: ['wss://nos.lol'],
      approve: async () => true,
      pool,
    })
    const clientPub = getPublicKey(generateSecretKey())
    const uri = `nostrconnect://${clientPub}?relay=wss%3A%2F%2Frelay.nsec.app&secret=sek`

    await connectApp({ session, uri, identityName: 'magazine', askEachTime: false, schedule: () => {} })

    const app = await getApp('magazine', clientPub)
    expect(app?.policies).toEqual({ sign: 'always', dm: 'always', profile: 'decline' })

    session.lock()
  })

  it('re-publishes the connect ack on a long decaying schedule to survive a backgrounded client tab', async () => {
    const published: NostrEvent[] = []
    const { pool } = makeFakePool(published)
    const session = createSession({
      mnemonic: M,
      identityNames: ['magazine'],
      relays: ['wss://nos.lol'],
      approve: async () => true,
      pool,
    })
    const clientPub = getPublicKey(generateSecretKey())
    const uri = `nostrconnect://${clientPub}?relay=wss%3A%2F%2Frelay.nsec.app&secret=sek`

    // Capture scheduled re-publishes instead of running real timers.
    const scheduled: Array<{ cb: () => void; delay: number }> = []
    const schedule = (cb: () => void, delay: number) => { scheduled.push({ cb, delay }) }

    await connectApp({ session, uri, identityName: 'magazine', schedule })

    // Only the immediate ack has gone out so far.
    expect(published.length).toBe(1)
    // Re-publishes follow the exported schedule…
    expect(scheduled.map(s => s.delay)).toEqual(ACK_REPUBLISH_DELAYS_MS)
    // …which is strictly increasing and spans at least two minutes, so the ack is still being
    // broadcast when a Safari-suspended client tab returns to the foreground and its relay
    // subscription reconnects (the ack is ephemeral — the relay only delivers it live).
    expect(ACK_REPUBLISH_DELAYS_MS[ACK_REPUBLISH_DELAYS_MS.length - 1]).toBeGreaterThanOrEqual(120_000)
    expect(ACK_REPUBLISH_DELAYS_MS.every((d, i) => i === 0 || d > ACK_REPUBLISH_DELAYS_MS[i - 1])).toBe(true)
    // Firing every scheduled job re-sends the SAME signed ack event (a connected client ignores dupes).
    const ackId = published[0].id
    scheduled.forEach(s => s.cb())
    expect(published.length).toBe(1 + ACK_REPUBLISH_DELAYS_MS.length)
    expect(published.every(e => e.id === ackId)).toBe(true)

    session.lock()
  })

  it('throws on an invalid URI', async () => {
    const published: NostrEvent[] = []
    const { pool } = makeFakePool(published)
    const session = createSession({
      mnemonic: M,
      identityNames: ['magazine'],
      relays: ['wss://relay.damus.io'],
      approve: async () => true,
      pool,
    })

    await expect(connectApp({ session, uri: 'not-a-uri', identityName: 'magazine' }))
      .rejects.toThrow('invalid nostrconnect URI')

    session.lock()
  })

  it('appNameFromUri falls back to a truncated pubkey', () => {
    const clientPub = getPublicKey(generateSecretKey())
    const req = parseNostrConnectURI(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Frelay.nsec.app&secret=s`)!
    expect(appNameFromUri(req)).toContain(clientPub.slice(0, 8))
  })

  // M1: a nostrconnect app's relays are persisted with it, and the next pairing keeps listening
  // on them rather than replacing the session relays with prefs ∪ {newest app's relay}.
  it("persists the app's relays and keeps listening on an earlier app's relay after a second pairing", async () => {
    const published: NostrEvent[] = []
    const { pool, subscribedRelays } = makeFakePool(published)
    const session = createSession({ mnemonic: M, identityNames: ['magazine'], relays: ['wss://relay.damus.io'], approve: async () => true, pool })

    const a = getPublicKey(generateSecretKey())
    const b = getPublicKey(generateSecretKey())
    await connectApp({ session, uri: `nostrconnect://${a}?relay=wss%3A%2F%2Frelay.a.example&secret=s1`, identityName: 'magazine', schedule: () => {} })
    await connectApp({ session, uri: `nostrconnect://${b}?relay=wss%3A%2F%2Frelay.b.example&secret=s2`, identityName: 'magazine', schedule: () => {} })

    expect((await getApp('magazine', a))?.relays).toEqual(['wss://relay.a.example'])
    const last = subscribedRelays.at(-1)!
    expect(last).toContain('wss://relay.a.example')
    expect(last).toContain('wss://relay.b.example')
    session.lock()
  })

  // L10: re-pairing an app that is already connected keeps the user's label and per-kind overrides.
  // The Ask-each-time / Auto-trust choice made on the connect screen DOES replace the app's
  // category-level policies (sign/dm/profile) — it is an explicit re-decision, not ignored.
  it('re-pairing an existing app replaces its category policies with the connect-screen choice, keeping label and per-kind overrides', async () => {
    const published: NostrEvent[] = []
    const { pool } = makeFakePool(published)
    const session = createSession({ mnemonic: M, identityNames: ['magazine'], relays: ['wss://relay.damus.io'], approve: async () => true, pool })
    const c = getPublicKey(generateSecretKey())
    await putApp({
      clientPubkey: c, identityName: 'magazine', appName: 'Old name', label: 'My client',
      policies: { sign: 'always', dm: 'ask', profile: 'decline' }, kindPolicies: { '7': 'always' }, connectedAt: 1,
    })

    // Re-pairing with the default (ask-each-time) choice replaces the app's old auto-trust policy.
    await connectApp({ session, uri: `nostrconnect://${c}?relay=wss%3A%2F%2Frelay.new.example&secret=s&name=Coracle&url=https%3A%2F%2Fcoracle.social`, identityName: 'magazine', schedule: () => {} })

    const app = await getApp('magazine', c)
    expect(app?.label).toBe('My client') // preserved
    expect(app?.kindPolicies).toEqual({ '7': 'always' }) // preserved
    expect(app?.policies).toEqual({ sign: 'ask', dm: 'ask', profile: 'ask' }) // replaced by the choice
    expect(app?.appName).toBe('Coracle')
    expect(app?.appUrl).toBe('https://coracle.social')
    expect(app?.relays).toEqual(['wss://relay.new.example'])
    expect(app?.connectedAt).toBeGreaterThan(1)
    session.lock()
  })

  it('re-pairing an existing app with Auto-trust replaces its category policies accordingly, still keeping label and per-kind overrides', async () => {
    const published: NostrEvent[] = []
    const { pool } = makeFakePool(published)
    const session = createSession({ mnemonic: M, identityNames: ['magazine'], relays: ['wss://relay.damus.io'], approve: async () => true, pool })
    const c = getPublicKey(generateSecretKey())
    await putApp({
      clientPubkey: c, identityName: 'magazine', appName: 'Old name', label: 'My client',
      policies: { sign: 'ask', dm: 'ask', profile: 'ask' }, kindPolicies: { '7': 'always' }, connectedAt: 1,
    })

    await connectApp({ session, uri: `nostrconnect://${c}?relay=wss%3A%2F%2Frelay.new.example&secret=s`, identityName: 'magazine', askEachTime: false, schedule: () => {} })

    const app = await getApp('magazine', c)
    expect(app?.label).toBe('My client') // preserved
    expect(app?.kindPolicies).toEqual({ '7': 'always' }) // preserved
    expect(app?.policies).toEqual({ sign: 'always', dm: 'always', profile: 'decline' }) // replaced by the choice
    session.lock()
  })
})
