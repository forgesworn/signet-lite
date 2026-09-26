import { describe, it, expect, beforeEach } from 'vitest'
import { saveMaster, loadMaster, addIdentityRecord, removeIdentityRecord, listIdentities, putApp, getApp, removeApp, listApps, loadPrefs, savePrefs, clearAll, appPolicies, appDisplayName, renameApp, setAppPolicy, setAppKindPolicy, saveProfile, loadProfile, listProfiles, removeProfile, appendActivity, listActivity, clearActivity, rememberHandledRequest, hasHandledRequest, updateMaster, __resetDbForTests } from './db.js'
import type { ActivityEntry } from './db.js'
import { deleteDB, openDB } from 'idb'

describe('db', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('round-trips a PIN-only master', async () => {
    await saveMaster({ ciphertext: 'enc...', backedUp: false, pin: { wrapped: 'pinwrap' } })
    expect(await loadMaster()).toEqual({ ciphertext: 'enc...', backedUp: false, pin: { wrapped: 'pinwrap' } })
  })

  it('round-trips a master with both PIN and biometric wraps', async () => {
    await saveMaster({
      ciphertext: 'enc...',
      backedUp: true,
      pin: { wrapped: 'pinwrap' },
      biometric: { credentialId: 'Y3JlZA==', prf: true, wrapped: 'biowrap' },
    })
    const m = await loadMaster()
    expect(m?.biometric?.prf).toBe(true)
    expect(m?.biometric?.credentialId).toBe('Y3JlZA==')
    expect(m?.pin?.wrapped).toBe('pinwrap')
  })

  it('clearAll wipes master, identities, apps and prefs', async () => {
    await saveMaster({ ciphertext: 'x', backedUp: false, pin: { wrapped: 'w' } })
    await addIdentityRecord({ name: 'magazine', npub: 'npub1mag', pubkeyHex: 'aa' })
    await putApp({ clientPubkey: 'c1', identityName: 'magazine', appName: 'A', policy: 'ask', connectedAt: 1 })
    await savePrefs({ theme: 'dark', relays: ['wss://relay.example'], explain: true, blossomServer: 'https://b.example' })

    await clearAll()

    expect(await loadMaster()).toBeUndefined()
    expect(await listIdentities()).toHaveLength(0)
    expect(await listApps()).toHaveLength(0)
    expect((await loadPrefs()).theme).toBe('system') // back to defaults
  })
  it('adds and lists identities', async () => {
    await addIdentityRecord({ name: 'magazine', npub: 'npub1mag', pubkeyHex: 'aa' })
    await addIdentityRecord({ name: 'meme', npub: 'npub1meme', pubkeyHex: 'bb' })
    const names = (await listIdentities()).map(i => i.name).sort()
    expect(names).toEqual(['magazine', 'meme'])
  })

  it('removeIdentityRecord removes the identity by name', async () => {
    await addIdentityRecord({ name: 'magazine', npub: 'npub1mag', pubkeyHex: 'aa' })
    await addIdentityRecord({ name: 'meme', npub: 'npub1meme', pubkeyHex: 'bb' })
    await removeIdentityRecord('magazine')
    const names = (await listIdentities()).map(i => i.name)
    expect(names).toEqual(['meme'])
  })
  it('puts, gets, lists and removes apps keyed by identity and clientPubkey', async () => {
    await putApp({ clientPubkey: 'c1', identityName: 'magazine', appName: 'Highlighter', policy: 'ask', connectedAt: 1 })
    expect((await getApp('magazine', 'c1'))?.appName).toBe('Highlighter')
    await putApp({ clientPubkey: 'c1', identityName: 'magazine', appName: 'Highlighter', policy: 'always-allow', connectedAt: 1 })
    expect((await getApp('magazine', 'c1'))?.policy).toBe('always-allow')  // put overwrites same identity+client
    await putApp({ clientPubkey: 'c1', identityName: 'meme', appName: 'Highlighter 2', policy: 'ask', connectedAt: 2 })
    expect(await listApps()).toHaveLength(2)
    await removeApp('magazine', 'c1')
    expect(await listApps()).toHaveLength(1)
    await removeApp('meme', 'c1')
    expect(await listApps()).toHaveLength(0)
  })
  it("leaves relay.trotters.cc out of a fresh install's relay list", async () => {
    expect((await loadPrefs()).relays).not.toContain('wss://relay.trotters.cc')
  })
  it('returns default prefs when unset, then round-trips saved prefs', async () => {
    const d = await loadPrefs()
    expect(d.theme).toBe('system')
    expect(d.relays.length).toBeGreaterThan(0)
    expect(d.explain).toBe(true) // explanations on by default
    await savePrefs({ theme: 'dark', relays: ['wss://relay.example'], explain: true, blossomServer: 'https://b.example' })
    expect((await loadPrefs()).theme).toBe('dark')
  })

  it('appPolicies normalises new, legacy and missing policy records', () => {
    expect(appPolicies({ policies: { sign: 'always', dm: 'ask' } })).toEqual({ sign: 'always', dm: 'ask', profile: 'decline' })
    expect(appPolicies({ policy: 'always-allow' })).toEqual({ sign: 'always', dm: 'always', profile: 'decline' })
    expect(appPolicies({ policy: 'ask' })).toEqual({ sign: 'ask', dm: 'ask', profile: 'decline' })
    expect(appPolicies({})).toEqual({ sign: 'ask', dm: 'ask', profile: 'decline' })
  })

  it('appDisplayName prefers a non-blank label, else the app name', () => {
    expect(appDisplayName({ label: 'noStrudel', appName: 'App abcd' })).toBe('noStrudel')
    expect(appDisplayName({ label: '   ', appName: 'App abcd' })).toBe('App abcd')
    expect(appDisplayName({ appName: 'App abcd' })).toBe('App abcd')
  })

  it('renameApp sets a label, and clears it when blank', async () => {
    await putApp({ clientPubkey: 'c1', identityName: 'magazine', appName: 'App c1', policies: { sign: 'ask', dm: 'ask' }, connectedAt: 1 })
    await renameApp('magazine', 'c1', '  noStrudel  ')
    expect((await getApp('magazine', 'c1'))?.label).toBe('noStrudel')
    await renameApp('magazine', 'c1', '   ')
    expect((await getApp('magazine', 'c1'))?.label).toBeUndefined()
  })

  it('setAppPolicy updates one category, preserves the other, and drops the legacy field', async () => {
    await putApp({ clientPubkey: 'c1', identityName: 'magazine', appName: 'App c1', policy: 'always-allow', connectedAt: 1 })
    await setAppPolicy('magazine', 'c1', 'dm', 'ask')
    const app = await getApp('magazine', 'c1')
    // legacy 'always-allow' read as both-always, then dm flipped to ask; profile defaults to decline
    expect(app?.policies).toEqual({ sign: 'always', dm: 'ask', profile: 'decline' })
    expect(app?.policy).toBeUndefined()
  })

  it('setAppKindPolicy sets, overwrites and removes a per-kind override, dropping the legacy field', async () => {
    await putApp({ clientPubkey: 'c1', identityName: 'magazine', appName: 'App c1', policy: 'ask', connectedAt: 1 })
    await setAppKindPolicy('magazine', 'c1', 1, 'always')
    expect((await getApp('magazine', 'c1'))?.kindPolicies).toEqual({ '1': 'always' })
    expect((await getApp('magazine', 'c1'))?.policy).toBeUndefined() // legacy field dropped
    // A second kind, then overwrite the first.
    await setAppKindPolicy('magazine', 'c1', 7, 'always')
    await setAppKindPolicy('magazine', 'c1', 1, 'ask')
    expect((await getApp('magazine', 'c1'))?.kindPolicies).toEqual({ '1': 'ask', '7': 'always' })
    // null removes one override, leaving the rest.
    await setAppKindPolicy('magazine', 'c1', 1, null)
    expect((await getApp('magazine', 'c1'))?.kindPolicies).toEqual({ '7': 'always' })
  })

  it('defaults to a Blossom server in prefs', async () => {
    expect((await loadPrefs()).blossomServer).toBe('https://blossom.band')
  })

  it('round-trips a profile including its avatar blob, keyed by identity name', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    await saveProfile({ name: 'magazine', metadata: { name: 'Mag', about: 'hi', lud16: 'a@b.com' }, avatarBlob: blob, updatedAt: 5 })
    const p = await loadProfile('magazine')
    expect(p?.metadata).toEqual({ name: 'Mag', about: 'hi', lud16: 'a@b.com' })
    expect(p?.avatarBlob?.type).toBe('image/png')
    expect(Array.from(new Uint8Array(await p!.avatarBlob!.arrayBuffer()))).toEqual([1, 2, 3])
    expect(await listProfiles()).toHaveLength(1)
    await removeProfile('magazine')
    expect(await loadProfile('magazine')).toBeUndefined()
  })

  it('appendActivity records a line and listActivity returns it newest-first', async () => {
    await appendActivity({ ts: 100, identityName: 'magazine', clientPubkey: 'c1', method: 'sign_event', kind: 1, outcome: 'signed' })
    await appendActivity({ ts: 200, identityName: 'magazine', clientPubkey: 'c1', method: 'get_public_key', outcome: 'signed' })
    await appendActivity({ ts: 150, identityName: 'meme', clientPubkey: 'c2', method: 'sign_event', kind: 1, outcome: 'denied' })
    const all = await listActivity()
    expect(all.map(e => e.ts)).toEqual([200, 150, 100]) // newest-first
    expect(all[2]).toMatchObject({ method: 'sign_event', kind: 1, outcome: 'signed' })
  })

  it('listActivity filters by clientPubkey and identity, and honours limit', async () => {
    await appendActivity({ ts: 1, identityName: 'magazine', clientPubkey: 'c1', method: 'sign_event', outcome: 'signed' })
    await appendActivity({ ts: 2, identityName: 'magazine', clientPubkey: 'c2', method: 'sign_event', outcome: 'signed' })
    await appendActivity({ ts: 3, identityName: 'meme', clientPubkey: 'c1', method: 'sign_event', outcome: 'signed' })
    expect(await listActivity({ clientPubkey: 'c1' })).toHaveLength(2)
    expect(await listActivity({ identityName: 'magazine' })).toHaveLength(2)
    expect(await listActivity({ identityName: 'magazine', clientPubkey: 'c1' })).toHaveLength(1)
    expect(await listActivity({ limit: 1 })).toHaveLength(1)
  })

  it('appendActivity caps the log to `max` newest entries', async () => {
    for (let i = 1; i <= 5; i++) {
      await appendActivity({ ts: i, identityName: 'magazine', clientPubkey: 'c1', method: 'sign_event', outcome: 'signed' }, { max: 3 })
    }
    const kept = await listActivity()
    expect(kept).toHaveLength(3)
    expect(kept.map(e => e.ts)).toEqual([5, 4, 3]) // oldest dropped
  })

  it('appendActivity drops entries older than the TTL relative to the newest ts', async () => {
    await appendActivity({ ts: 1000, identityName: 'magazine', clientPubkey: 'c1', method: 'sign_event', outcome: 'signed' }, { ttlSeconds: 100 })
    // ts 1201 is "now"; cutoff is 1101, so the ts-1000 row falls out of the window.
    await appendActivity({ ts: 1201, identityName: 'magazine', clientPubkey: 'c1', method: 'sign_event', outcome: 'signed' }, { ttlSeconds: 100 })
    const kept = await listActivity()
    expect(kept.map(e => e.ts)).toEqual([1201])
  })

  it('persists only metadata — never content, plaintext, or a DM counterparty pubkey', async () => {
    await appendActivity({ ts: 1, identityName: 'magazine', clientPubkey: 'c1', method: 'nip44_decrypt', outcome: 'signed' })
    const [entry] = await listActivity()
    const keys = Object.keys(entry).sort()
    expect(keys).toEqual(['clientPubkey', 'id', 'identityName', 'method', 'outcome', 'ts'])
    const e = entry as ActivityEntry & Record<string, unknown>
    expect(e.content).toBeUndefined()
    expect(e.plaintextPreview).toBeUndefined()
    expect(e.peerPubkey).toBeUndefined()
  })

  it('clearActivity empties the log, and respects a per-app filter', async () => {
    await appendActivity({ ts: 1, identityName: 'magazine', clientPubkey: 'c1', method: 'sign_event', outcome: 'signed' })
    await appendActivity({ ts: 2, identityName: 'magazine', clientPubkey: 'c2', method: 'sign_event', outcome: 'signed' })
    await clearActivity({ clientPubkey: 'c1' })
    expect((await listActivity()).map(e => e.clientPubkey)).toEqual(['c2'])
    await clearActivity()
    expect(await listActivity()).toHaveLength(0)
  })

  it('clearAll wipes the activity log too', async () => {
    await appendActivity({ ts: 1, identityName: 'magazine', clientPubkey: 'c1', method: 'sign_event', outcome: 'signed' })
    await clearAll()
    expect(await listActivity()).toHaveLength(0)
  })

  it('rememberHandledRequest reports recent duplicates and expires old ids', async () => {
    expect(await rememberHandledRequest('evt1', 100, { ttlSeconds: 10 })).toBe(false)
    expect(await rememberHandledRequest('evt1', 105, { ttlSeconds: 10 })).toBe(true)
    expect(await rememberHandledRequest('evt1', 116, { ttlSeconds: 10 })).toBe(false)
  })

  it('hasHandledRequest checks recent ids without inserting them', async () => {
    expect(await hasHandledRequest('evt1', 100, { ttlSeconds: 10 })).toBe(false)
    expect(await rememberHandledRequest('evt1', 100, { ttlSeconds: 10 })).toBe(false)
    expect(await hasHandledRequest('evt1', 105, { ttlSeconds: 10 })).toBe(true)
    expect(await hasHandledRequest('evt1', 111, { ttlSeconds: 10 })).toBe(false)
    expect(await rememberHandledRequest('evt2', 112, { ttlSeconds: 10 })).toBe(false)
  })

  it('clearAll wipes handled request ids too', async () => {
    await rememberHandledRequest('evt1', 100)
    await clearAll()
    expect(await rememberHandledRequest('evt1', 101)).toBe(false)
  })

  // The optional StoredApp.relays field (M1) is additive: no IndexedDB store/version change. An app
  // record written by the current release (DB v5, no `relays`) must read back unchanged.
  it('reads an existing v5 app record that predates the relays field', async () => {
    const raw = await openDB('signet-lite', 5, {
      upgrade(d) {
        d.createObjectStore('master'); d.createObjectStore('identities', { keyPath: 'name' })
        d.createObjectStore('apps', { keyPath: 'clientPubkey' }); d.createObjectStore('prefs')
        d.createObjectStore('profiles', { keyPath: 'name' }); d.createObjectStore('appAccess', { keyPath: 'appKey' })
        d.createObjectStore('activity', { keyPath: 'id', autoIncrement: true }); d.createObjectStore('handledRequests', { keyPath: 'id' })
      },
    })
    await raw.put('appAccess', { appKey: 'c1:default', clientPubkey: 'c1', identityName: 'default', appName: 'Old', policies: { sign: 'always', dm: 'ask' }, connectedAt: 1 })
    raw.close()

    const app = await getApp('default', 'c1')
    expect(app?.appName).toBe('Old')
    expect(app?.relays).toBeUndefined()
    expect(await listApps()).toHaveLength(1)
  })

  it('updateMaster is a no-op when there is no master, and applies fn to the stored value', async () => {
    expect(await updateMaster(m => ({ ...m, backedUp: true }))).toBeUndefined()
    await saveMaster({ ciphertext: 'x', backedUp: false })
    await updateMaster(m => ({ ...m, backedUp: true }))
    expect((await loadMaster())?.backedUp).toBe(true)
    await updateMaster(() => null)
    expect((await loadMaster())?.backedUp).toBe(true)
  })

  it('clearAll with a replacement master wipes everything else and leaves only the new master', async () => {
    await saveMaster({ ciphertext: 'old', backedUp: true })
    await addIdentityRecord({ name: 'default', npub: 'npub1x', pubkeyHex: 'ab' })
    await clearAll({ replacementMaster: { ciphertext: 'new', backedUp: false } })
    expect((await loadMaster())?.ciphertext).toBe('new')
    expect(await listIdentities()).toEqual([])
  })
})
