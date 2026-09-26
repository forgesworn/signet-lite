import { describe, it, expect, vi, beforeEach } from 'vitest'
import { refreshProfiles } from './refresh-profiles.js'
import { saveProfile, loadProfile, __resetDbForTests } from '../../app/db.js'
import { deleteDB } from 'idb'

describe('refreshProfiles', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('stores fetched metadata for each identity that has a kind 0', async () => {
    const fetchMany = vi.fn(async () => new Map([
      ['pkA', { metadata: { name: 'donkey', display_name: 'TheCryptoDonkey' }, raw: {} }],
    ]))
    await refreshProfiles(['wss://r'], [{ name: 'default', pubkeyHex: 'pkA' }], fetchMany, 7)
    const stored = await loadProfile('default')
    expect(stored?.metadata.display_name).toBe('TheCryptoDonkey')
    expect(stored?.updatedAt).toBe(7)
  })

  it('preserves an existing locally-uploaded avatar blob', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    await saveProfile({ name: 'default', metadata: { name: 'old' }, avatarBlob: blob, updatedAt: 1 })
    const fetchMany = vi.fn(async () => new Map([
      ['pkA', { metadata: { name: 'new', picture: 'https://x/p.png' }, raw: {} }],
    ]))
    await refreshProfiles(['wss://r'], [{ name: 'default', pubkeyHex: 'pkA' }], fetchMany, 2)
    const stored = await loadProfile('default')
    expect(stored?.metadata.name).toBe('new')
    expect(stored?.avatarBlob?.size).toBe(3)
  })

  it('does not clobber a saved profile when no kind 0 is found', async () => {
    await saveProfile({ name: 'default', metadata: { name: 'kept' }, updatedAt: 1 })
    const fetchMany = vi.fn(async () => new Map())
    await refreshProfiles(['wss://r'], [{ name: 'default', pubkeyHex: 'pkA' }], fetchMany, 9)
    const stored = await loadProfile('default')
    expect(stored?.metadata.name).toBe('kept')
    expect(stored?.updatedAt).toBe(1)
  })
})
