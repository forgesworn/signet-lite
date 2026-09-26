import { describe, it, expect, vi, beforeEach } from 'vitest'
import { publishProfile } from './save-profile.js'
import { saveProfile, loadProfile, __resetDbForTests } from '../../app/db.js'
import type { Session } from '../../app/session.js'
import type { Event as NostrEvent } from 'nostr-tools'
import { deleteDB } from 'idb'

function fakeSession(published: NostrEvent[]) {
  const signEventAs = vi.fn((_name: string, t: { kind: number; content: string }) =>
    ({ kind: t.kind, content: t.content, id: 'evt', pubkey: 'p', sig: 's', tags: [], created_at: 0 } as unknown as NostrEvent))
  const session = { signer: { signEventAs }, publish: (e: NostrEvent) => { published.push(e) } } as unknown as Session
  return { session, signEventAs }
}

describe('publishProfile', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('uploads a new avatar, sets picture to its URL, publishes a kind-0, and stores a local copy', async () => {
    const published: NostrEvent[] = []
    const { session } = fakeSession(published)
    const upload = vi.fn(async () => ({ url: 'https://blossom.band/x.png', sha256: 'x' }))
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

    await publishProfile({
      session, identityName: 'magazine', metadata: { name: 'Mag', about: 'hi' },
      newAvatar: blob, blossomServer: 'https://blossom.band', upload, now: 7,
    })

    expect(upload).toHaveBeenCalledOnce()
    // kind-0 published with the uploaded picture URL merged in
    expect(published).toHaveLength(1)
    expect(published[0].kind).toBe(0)
    expect(JSON.parse(published[0].content)).toEqual({ name: 'Mag', about: 'hi', picture: 'https://blossom.band/x.png' })
    // local copy saved with the blob + url
    const stored = await loadProfile('magazine')
    expect(stored?.metadata.picture).toBe('https://blossom.band/x.png')
    expect(stored?.avatarBlob?.size).toBe(3)
    expect(stored?.updatedAt).toBe(7)
  })

  it('without a new avatar: does not upload, keeps the existing local avatar, and preserves unmanaged base keys', async () => {
    const published: NostrEvent[] = []
    const { session } = fakeSession(published)
    const upload = vi.fn()
    // seed an existing local avatar
    const existing = new Blob([new Uint8Array([9, 9])], { type: 'image/png' })
    await saveProfile({ name: 'magazine', metadata: { name: 'Old', picture: 'https://b/old.png' }, avatarBlob: existing, updatedAt: 1 })

    await publishProfile({
      session, identityName: 'magazine',
      metadata: { name: 'New', picture: 'https://b/old.png' },
      base: { name: 'Old', banner: 'https://b/banner.png' },
      blossomServer: 'https://blossom.band', upload, now: 8,
    })

    expect(upload).not.toHaveBeenCalled()
    // unmanaged 'banner' survives the republish
    expect(JSON.parse(published[0].content)).toEqual({ name: 'New', banner: 'https://b/banner.png', picture: 'https://b/old.png' })
    // existing local avatar retained
    const stored = await loadProfile('magazine')
    expect(stored?.avatarBlob?.size).toBe(2)
  })
})
