import { describe, it, expect, beforeEach, vi } from 'vitest'
import { deleteSignet } from './delete-signet.js'
import { saveMaster, loadMaster, addIdentityRecord, listIdentities, putApp, listApps, savePrefs, loadPrefs, __resetDbForTests } from '../app/db.js'
import type { Session } from '../app/session.js'
import { deleteDB } from 'idb'

describe('deleteSignet', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('locks the live session and wipes every stored record', async () => {
    await saveMaster({ ciphertext: 'x', backedUp: true })
    await addIdentityRecord({ name: 'default', npub: 'npub1x', pubkeyHex: 'ab' })
    await putApp({ clientPubkey: 'c1', identityName: 'default', appName: 'App', policy: 'ask', connectedAt: 1 })
    await savePrefs({ theme: 'dark', relays: ['wss://relay.example'], explain: false, blossomServer: 'https://b.example' })

    const lock = vi.fn()
    await deleteSignet({ session: { lock } as unknown as Session })

    // Live signer stopped (key material dropped) before the wipe.
    expect(lock).toHaveBeenCalledTimes(1)
    // Every store is empty afterwards.
    expect(await loadMaster()).toBeUndefined()
    expect(await listIdentities()).toEqual([])
    expect(await listApps()).toEqual([])
    // prefs fall back to defaults (theme 'system'), proving the prefs store was cleared.
    expect((await loadPrefs()).theme).toBe('system')
  })

  it('tolerates a null session (already locked) and still wipes the data', async () => {
    await saveMaster({ ciphertext: 'x', backedUp: true })
    await deleteSignet({ session: null })
    expect(await loadMaster()).toBeUndefined()
  })
})
