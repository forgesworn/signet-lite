import { describe, it, expect, beforeEach } from 'vitest'
import { setupWithPin, setupWithPinPrf, upgradePinToPinPrf, unlockWithPin, getMnemonic, markBackedUp, enableBiometric, unlockWithBiometric, getRoot, type WebAuthnIO } from './auth.js'
import { loadMaster, __resetDbForTests, addIdentityRecord, listIdentities, putApp, listApps, saveProfile, listProfiles, appendActivity, listActivity, savePrefs, loadPrefs } from './db.js'
import { deleteDB } from 'idb'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('auth — PIN path', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('sets up with a PIN, then unlocks and recovers the mnemonic', async () => {
    await setupWithPin(M, '123456')
    const masterKey = await unlockWithPin('123456')
    expect(masterKey).toMatch(/^[0-9a-f]{64}$/)
    expect(await getMnemonic(masterKey!)).toBe(M)
  })

  it('rejects a non-6-digit PIN at setup', async () => {
    await expect(setupWithPin(M, '12ab')).rejects.toThrow('PIN must be 6 digits')
    await expect(setupWithPin(M, '12345')).rejects.toThrow('PIN must be 6 digits')
  })

  it('returns null on the wrong PIN', async () => {
    await setupWithPin(M, '123456')
    expect(await unlockWithPin('000000')).toBeNull()
  })

  it('returns null when no master is stored', async () => {
    expect(await unlockWithPin('123456')).toBeNull()
  })

  it('persists a PIN wrap, no biometric, and backedUp=false initially', async () => {
    await setupWithPin(M, '123456')
    const m = await loadMaster()
    expect(m?.pin?.wrapped).toBeTruthy()
    expect(m?.biometric).toBeUndefined()
    expect(m?.backedUp).toBe(false)
  })

  it('markBackedUp flips the flag', async () => {
    await setupWithPin(M, '123456')
    await markBackedUp()
    expect((await loadMaster())?.backedUp).toBe(true)
  })

  it('persists the PIN lockout across a simulated reload', async () => {
    await setupWithPin(M, '123456')
    for (let i = 0; i < 5; i++) expect(await unlockWithPin('000000')).toBeNull()
    // Simulate a page reload: the throttle must come from the DB, not module memory.
    // Re-read the master directly and assert a future lockout was persisted.
    const m = await loadMaster()
    expect((m?.pinLockedUntil ?? 0)).toBeGreaterThan(Date.now())
    // And a correct PIN is refused while locked.
    expect(await unlockWithPin('123456')).toBeNull()
  })

  it('clears the throttle on a correct PIN within the limit', async () => {
    await setupWithPin(M, '123456')
    expect(await unlockWithPin('000000')).toBeNull()
    expect(await unlockWithPin('123456')).not.toBeNull()
    const m = await loadMaster()
    expect(m?.pinFailures ?? 0).toBe(0)
  })
})

describe('auth — biometric path (injected IO)', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  // A fake authenticator that always yields the same PRF output.
  function prfIO(prfByte = 9): WebAuthnIO {
    const prf = () => new Uint8Array(32).fill(prfByte).buffer
    return {
      async create() { return { credentialId: 'Y3JlZA==', prfOutput: prf() } },
      async assert() { return { prfOutput: prf() } },
    }
  }

  it('enables biometric on top of a PIN, then unlocks with biometric', async () => {
    await setupWithPin(M, '123456')
    const masterKey = await unlockWithPin('123456')
    const res = await enableBiometric(masterKey!, prfIO())
    expect(res).toEqual({ ok: true, prfSupported: true })

    const viaBio = await unlockWithBiometric(prfIO())
    expect(viaBio).toBe(masterKey)
    expect(await getMnemonic(viaBio!)).toBe(M)
    // PIN still works alongside biometric.
    expect(await unlockWithPin('123456')).toBe(masterKey)
  })

  it('returns null when no biometric wrap is stored', async () => {
    await setupWithPin(M, '123456')
    expect(await unlockWithBiometric(prfIO())).toBeNull()
  })

  it('returns null when the assertion is cancelled', async () => {
    await setupWithPin(M, '123456')
    const masterKey = await unlockWithPin('123456')
    await enableBiometric(masterKey!, prfIO())
    const cancelIO: WebAuthnIO = { async create() { return null }, async assert() { return null } }
    expect(await unlockWithBiometric(cancelIO)).toBeNull()
  })

  it('rejects biometric setup when PRF is unavailable', async () => {
    await setupWithPin(M, '123456')
    const masterKey = await unlockWithPin('123456')
    const noPrfIO: WebAuthnIO = {
      async create() { return { credentialId: 'Y3JlZA==', prfOutput: null } },
      async assert() { return { prfOutput: null } },
    }
    const res = await enableBiometric(masterKey!, noPrfIO)
    expect(res).toEqual({ ok: false, prfSupported: false })
    expect((await loadMaster())?.biometric).toBeUndefined()
    expect(await unlockWithBiometric(noPrfIO)).toBeNull()
  })

  it('returns null when create is cancelled at enable time', async () => {
    await setupWithPin(M, '123456')
    const masterKey = await unlockWithPin('123456')
    const cancelIO: WebAuthnIO = { async create() { return null }, async assert() { return null } }
    expect(await enableBiometric(masterKey!, cancelIO)).toEqual({ ok: false, prfSupported: false })
  })

  // L7: the guarded update() in enableBiometric writes nothing if the root was replaced
  // underneath it during the WebAuthn ceremony (e.g. a restore landing in another tab). The
  // result must say so — reporting ok:true when the write was skipped would tell the UI Face ID
  // is on when it isn't.
  it('reports failure, not success, when the master was replaced during the PRF ceremony', async () => {
    await setupWithPin(M, '123456')
    const masterKey = await unlockWithPin('123456')

    const raceIO: WebAuthnIO = {
      async create() {
        // A concurrent replace of the root lands mid-ceremony, before enableBiometric's guarded
        // write runs.
        await setupWithPin('legal winner thank year wave sausage worth useful legal winner thank yellow', '654321', 'mnemonic', { replaceExisting: true })
        return { credentialId: 'Y3JlZA==', prfOutput: new Uint8Array(32).fill(9).buffer }
      },
      async assert() { return { prfOutput: new Uint8Array(32).fill(9).buffer } },
    }

    const res = await enableBiometric(masterKey!, raceIO)
    expect(res).toEqual({ ok: false, prfSupported: false })
    // Nothing was written on top of the new (replaced) master.
    expect((await loadMaster())?.biometric).toBeUndefined()
  })
})

describe('auth — secure quick unlock (PIN + WebAuthn PRF)', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  function prfIO(prfByte = 9): WebAuthnIO {
    const prf = () => new Uint8Array(32).fill(prfByte).buffer
    return {
      async create() { return { credentialId: 'Y3JlZA==', prfOutput: prf() } },
      async assert() { return { prfOutput: prf() } },
    }
  }

  it('sets up without a PIN-only wrap, then unlocks with PIN + PRF', async () => {
    const res = await setupWithPinPrf(M, '123456', 'mnemonic', prfIO())
    expect(res.ok).toBe(true)
    expect(res.masterKey).toMatch(/^[0-9a-f]{64}$/)

    const m = await loadMaster()
    expect(m?.pin).toBeUndefined()
    expect(m?.pinPrf?.wrapped).toBeTruthy()
    expect(m?.pinPrf?.credentialId).toBe('Y3JlZA==')
    expect(m?.biometric?.wrapped).toBeTruthy()

    const masterKey = await unlockWithPin('123456', prfIO())
    expect(masterKey).toBe(res.masterKey)
    expect(await getMnemonic(masterKey!)).toBe(M)
    expect(await unlockWithPin('000000', prfIO())).toBeNull()
    expect(await unlockWithBiometric(prfIO())).toBe(res.masterKey)
  })

  it('does not create a master record when PRF setup is unavailable', async () => {
    const noPrfIO: WebAuthnIO = {
      async create() { return { credentialId: 'Y3JlZA==', prfOutput: null } },
      async assert() { return { prfOutput: null } },
    }
    expect(await setupWithPinPrf(M, '123456', 'mnemonic', noPrfIO)).toEqual({ ok: false, prfSupported: false })
    expect(await loadMaster()).toBeUndefined()
  })

  it('upgrades a legacy PIN-only master and removes the PIN-only wrap', async () => {
    await setupWithPin(M, '123456')
    await markBackedUp()
    const legacyKey = await unlockWithPin('123456')
    expect((await loadMaster())?.pin?.wrapped).toBeTruthy()

    const res = await upgradePinToPinPrf('123456', prfIO())
    expect(res.ok).toBe(true)
    expect(res.masterKey).toBe(legacyKey)
    const m = await loadMaster()
    expect(m?.pin).toBeUndefined()
    expect(m?.pinPrf?.wrapped).toBeTruthy()
    expect(await unlockWithPin('123456', prfIO())).toBe(legacyKey)
  })

  it('leaves a legacy PIN-only master untouched when upgrade PIN is wrong', async () => {
    await setupWithPin(M, '123456')
    await markBackedUp()
    const res = await upgradePinToPinPrf('000000', prfIO())
    expect(res).toEqual({ ok: false, prfSupported: false })
    expect((await loadMaster())?.pin?.wrapped).toBeTruthy()
  })

  it('refuses to upgrade when the recovery phrase is not backed up', async () => {
    await setupWithPin(M, '123456')   // a mnemonic master starts backedUp=false
    const res = await upgradePinToPinPrf('123456', prfIO())
    expect(res).toEqual({ ok: false, prfSupported: false, reason: 'not-backed-up' })
    // The PIN-only wrap must survive, so the user can still unlock.
    expect((await loadMaster())?.pin?.wrapped).toBeTruthy()
    expect((await loadMaster())?.pinPrf).toBeUndefined()
  })
})

const NSEC = 'nsec1gc8hf0g9c33lu0qwj3l7dfstpwmrcskljy88zu4dnmv07sq0el8qftpamx'

describe('auth — root kind', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('a mnemonic setup round-trips via getRoot as kind mnemonic', async () => {
    await setupWithPin(M, '123456')
    const mk = (await unlockWithPin('123456'))!
    expect(await getRoot(mk)).toEqual({ kind: 'mnemonic', secret: M })
  })

  it('an nsec setup stores kind nsec, is backedUp, and round-trips the nsec', async () => {
    await setupWithPin(NSEC, '123456', 'nsec')
    const m = await loadMaster()
    expect(m?.rootKind).toBe('nsec')
    expect(m?.backedUp).toBe(true)
    const mk = (await unlockWithPin('123456'))!
    expect(await getRoot(mk)).toEqual({ kind: 'nsec', secret: NSEC })
  })
})

describe('auth — atomic master updates (L7)', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('counts every failure when two wrong-PIN attempts race', async () => {
    await setupWithPin(M, '123456')
    await Promise.all([unlockWithPin('000000'), unlockWithPin('111111')])
    expect((await loadMaster())?.pinFailures).toBe(2)
  })

  it('a failed attempt does not overwrite a markBackedUp made while its ceremony was in flight', async () => {
    const prf = () => new Uint8Array(32).fill(9).buffer
    await setupWithPinPrf(M, '123456', 'mnemonic', {
      async create() { return { credentialId: 'Y3JlZA==', prfOutput: prf() } },
      async assert() { return { prfOutput: prf() } },
    })
    expect((await loadMaster())?.backedUp).toBe(false)
    // The assertion takes a while; meanwhile another tab confirms the backup.
    const slowIO: WebAuthnIO = {
      async create() { return null },
      async assert() { await markBackedUp(); return { prfOutput: prf() } },
    }
    expect(await unlockWithPin('000000', slowIO)).toBeNull()
    const m = await loadMaster()
    expect(m?.backedUp).toBe(true)
    expect(m?.pinFailures).toBe(1)
  })
})

describe('auth — replacing an existing signet (H1)', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('setupWithPin with replaceExisting wipes every other store in the same write', async () => {
    await setupWithPin(M, '123456')
    await addIdentityRecord({ name: 'default', npub: 'npub1old', pubkeyHex: 'aa' })
    await putApp({ clientPubkey: 'c1', identityName: 'default', appName: 'Old', policies: { sign: 'always', dm: 'ask' }, connectedAt: 1 })
    await saveProfile({ name: 'default', metadata: { name: 'old' }, updatedAt: 1 })
    await appendActivity({ ts: Math.floor(Date.now() / 1000), identityName: 'default', clientPubkey: 'c1', method: 'sign_event', outcome: 'signed' })
    await savePrefs({ theme: 'dark', relays: ['wss://old.example'], explain: false, blossomServer: 'https://b.example' })
    for (let i = 0; i < 3; i++) await unlockWithPin('000000')

    await setupWithPin(NSEC, '654321', 'nsec', { replaceExisting: true })

    expect(await listIdentities()).toEqual([])
    expect(await listApps()).toEqual([])
    expect(await listProfiles()).toEqual([])
    expect(await listActivity()).toEqual([])
    const prefs = await loadPrefs()
    expect(prefs.theme).toBe('system')
    expect(prefs.relays).not.toContain('wss://old.example')
    const m = await loadMaster()
    expect(m?.pinFailures).toBe(0)
    expect(m?.rootKind).toBe('nsec')
    const mk = await unlockWithPin('654321')
    expect(await getRoot(mk!)).toEqual({ kind: 'nsec', secret: NSEC })
  })

  it('setupWithPinPrf with replaceExisting wipes the old data too', async () => {
    await setupWithPin(M, '123456')
    await addIdentityRecord({ name: 'default', npub: 'npub1old', pubkeyHex: 'aa' })
    const prf = () => new Uint8Array(32).fill(9).buffer
    const res = await setupWithPinPrf(M, '654321', 'mnemonic', {
      async create() { return { credentialId: 'Y3JlZA==', prfOutput: prf() } },
      async assert() { return { prfOutput: prf() } },
    }, { replaceExisting: true })
    expect(res.ok).toBe(true)
    expect(await listIdentities()).toEqual([])
    expect((await loadMaster())?.pin).toBeUndefined()
  })
})
