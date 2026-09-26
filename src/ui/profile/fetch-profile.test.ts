import { describe, it, expect, vi } from 'vitest'
import { fetchKind0, fetchKind0Many } from './fetch-profile.js'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

describe('fetchKind0', () => {
  it('queries by kind 0 + author and parses the returned profile', async () => {
    const sk = generateSecretKey()
    const pub = getPublicKey(sk)
    const event = finalizeEvent({ kind: 0, created_at: 1, tags: [], content: JSON.stringify({ name: 'Mag', banner: 'b.png' }) }, sk)
    const getEvent = vi.fn(async () => event)

    const res = await fetchKind0(['wss://r'], pub, getEvent)
    expect(getEvent).toHaveBeenCalledWith(['wss://r'], { kinds: [0], authors: [pub], limit: 1 })
    expect(res?.metadata).toEqual({ name: 'Mag' })
    expect(res?.raw).toMatchObject({ name: 'Mag', banner: 'b.png' })
  })

  it('returns null when no profile is found', async () => {
    const res = await fetchKind0(['wss://r'], 'abc', async () => null)
    expect(res).toBeNull()
  })
})

describe('fetchKind0Many', () => {
  it('queries kind 0 for all authors and returns the newest per author', async () => {
    const ev = (pubkey: string, created_at: number, content: object) =>
      ({ kind: 0, pubkey, created_at, tags: [], content: JSON.stringify(content), id: 'i', sig: 's' }) as unknown as import('nostr-tools').Event
    const getEvents = vi.fn(async () => [
      ev('A', 1, { name: 'old A' }),
      ev('A', 5, { name: 'new A' }),
      ev('B', 2, { display_name: 'Bee' }),
    ])

    const map = await fetchKind0Many(['wss://r'], ['A', 'B', 'C'], getEvents)
    expect(getEvents).toHaveBeenCalledWith(['wss://r'], { kinds: [0], authors: ['A', 'B', 'C'] })
    expect(map.get('A')?.metadata.name).toBe('new A')
    expect(map.get('B')?.metadata.display_name).toBe('Bee')
    expect(map.has('C')).toBe(false)
  })

  it('does no query and returns an empty map for an empty author list', async () => {
    const getEvents = vi.fn(async () => [])
    const map = await fetchKind0Many(['wss://r'], [], getEvents)
    expect(getEvents).not.toHaveBeenCalled()
    expect(map.size).toBe(0)
  })
})
