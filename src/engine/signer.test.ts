import { describe, it, expect } from 'vitest'
import { Signer, signerFromMnemonic, signerFromNsec } from './signer.js'
import type { ApprovalRequest } from './signer.js'
import { deriveIdentity } from './derive.js'
import { deriveChildFromNsec } from './nsec.js'
const NSEC = 'nsec1gc8hf0g9c33lu0qwj3l7dfstpwmrcskljy88zu4dnmv07sq0el8qftpamx'
const NPUB = 'npub10vssllkca9ecvn7dk9pvklls2fjfzyy3mqt3rp683fzepsg7skusaalt7w'
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import { bytesToHex } from 'nostr-tools/utils'
import { nip44Encrypt, nip44Decrypt } from './nip46.js'
import { encrypt as nip04Encrypt } from 'nostr-tools/nip04'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const approveAll = { approve: async () => true }

// Helper: build a valid NIP-44-encrypted kind-24133 request (matches relay.test.ts signReq)
async function signReq(clientSk: Uint8Array, idPubHex: string, body: object) {
  const content = await nip44Encrypt(bytesToHex(clientSk), idPubHex, JSON.stringify(body))
  return finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', idPubHex]], content }, clientSk)
}

// Helper: build a kind-24133 request encrypted from a client to an identity
async function reqEvent(clientSk: Uint8Array, identityPubHex: string, body: object) {
  const clientHex = bytesToHex(clientSk)
  const content = await nip44Encrypt(clientHex, identityPubHex, JSON.stringify(body))
  return finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', identityPubHex]], content }, clientSk)
}

describe('Signer.signEventAs', () => {
  it("signs the user's own event with the identity key (no gate), verifiable and authored by the identity", () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const signed = s.signEventAs('magazine', { kind: 0, content: JSON.stringify({ name: 'Mag' }) })
    expect(verifyEvent(signed)).toBe(true)
    expect(signed.kind).toBe(0)
    expect(signed.pubkey).toBe(mag.pubkeyHex)
    expect(JSON.parse(signed.content).name).toBe('Mag')
    expect(signed.tags).toEqual([])
  })

  it('throws for an unknown identity', () => {
    const s = signerFromMnemonic(M, ['magazine'])
    expect(() => s.signEventAs('ghost', { kind: 0, content: '{}' })).toThrow(/unknown identity/)
  })
})

describe('Signer', () => {
  it('signs an event for an approved (paired) client as the named identity, response is encrypted', async () => {
    const s = signerFromMnemonic(M, ['magazine'], approveAll)
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey()
    const clientPub = getPublicKey(clientSk)

    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')

    const ev = await reqEvent(clientSk, mag.pubkeyHex,
      { id: '1', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'hi' })] })
    const resp = await s.handleRequestEvent(ev)

    // Response is a valid signed kind-24133 from the identity key
    expect(resp).not.toBeNull()
    expect(verifyEvent(resp!)).toBe(true)
    expect(resp!.pubkey).toBe(mag.pubkeyHex)

    // Response content must be NIP-44 encrypted to the client
    const decrypted = await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, resp!.content)
    const parsed = JSON.parse(decrypted)       // { id, result }
    const signed = JSON.parse(parsed.result)   // the signed event
    expect(verifyEvent(signed)).toBe(true)
    expect(signed.pubkey).toBe(mag.pubkeyHex)
  })

  it('ignores requests from a client that never paired', async () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const strangerSk = generateSecretKey()
    const ev = await reqEvent(strangerSk, mag.pubkeyHex,
      { id: '9', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'x' })] })
    expect(await s.handleRequestEvent(ev)).toBeNull()
  })

  it('returns an encrypted error response (not a throw) when an approved client sends malformed params', async () => {
    const s = signerFromMnemonic(M, ['magazine'], approveAll)
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    const ev = await reqEvent(clientSk, mag.pubkeyHex, { id: '7', method: 'sign_event', params: [] })
    const resp = await s.handleRequestEvent(ev)          // must NOT throw/reject
    expect(resp).not.toBeNull()
    const decrypted = await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, resp!.content)
    const parsed = JSON.parse(decrypted)
    expect(parsed.id).toBe('7')
    expect(parsed.error).toBeTruthy()
    expect(parsed.result).toBeUndefined()
  })

  it('connect → decrypted result is "ack"', async () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    const ev = await reqEvent(clientSk, mag.pubkeyHex, { id: 'c1', method: 'connect', params: [] })
    const resp = await s.handleRequestEvent(ev)
    expect(resp).not.toBeNull()
    const decrypted = await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, resp!.content)
    const parsed = JSON.parse(decrypted)
    expect(parsed.result).toBe('ack')
    expect(parsed.error).toBeUndefined()
  })

  it('ping → decrypted result is "pong"', async () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    const ev = await reqEvent(clientSk, mag.pubkeyHex, { id: 'p1', method: 'ping', params: [] })
    const resp = await s.handleRequestEvent(ev)
    expect(resp).not.toBeNull()
    const decrypted = await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, resp!.content)
    const parsed = JSON.parse(decrypted)
    expect(parsed.result).toBe('pong')
    expect(parsed.error).toBeUndefined()
  })

  it('get_public_key → decrypted result equals the identity pubkeyHex', async () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    const ev = await reqEvent(clientSk, mag.pubkeyHex, { id: 'g1', method: 'get_public_key', params: [] })
    const resp = await s.handleRequestEvent(ev)
    expect(resp).not.toBeNull()
    const decrypted = await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, resp!.content)
    const parsed = JSON.parse(decrypted)
    expect(parsed.result).toBe(mag.pubkeyHex)
    expect(parsed.error).toBeUndefined()
  })

  it('nip44_encrypt then nip44_decrypt round-trip via the signer returns the original plaintext', async () => {
    const s = signerFromMnemonic(M, ['magazine'], approveAll)
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')

    const plaintext = 'hello signet-lite'

    // Encrypt: ask the signer to encrypt plaintext to clientPub
    const encReq = await reqEvent(clientSk, mag.pubkeyHex,
      { id: 'e1', method: 'nip44_encrypt', params: [clientPub, plaintext] })
    const encResp = await s.handleRequestEvent(encReq)
    expect(encResp).not.toBeNull()
    const encDecrypted = await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, encResp!.content)
    const encParsed = JSON.parse(encDecrypted)
    expect(encParsed.error).toBeUndefined()
    const ciphertext = encParsed.result as string

    // Decrypt: ask the signer to decrypt it back
    const decReq = await reqEvent(clientSk, mag.pubkeyHex,
      { id: 'e2', method: 'nip44_decrypt', params: [clientPub, ciphertext] })
    const decResp = await s.handleRequestEvent(decReq)
    expect(decResp).not.toBeNull()
    const decDecrypted = await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, decResp!.content)
    const decParsed = JSON.parse(decDecrypted)
    expect(decParsed.result).toBe(plaintext)
    expect(decParsed.error).toBeUndefined()
  })

  it('nip04_decrypt via the signer returns the original plaintext (legacy DM read support)', async () => {
    const s = signerFromMnemonic(M, ['magazine'], approveAll)
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')

    const plaintext = 'legacy nip04 dm'
    // A NIP-04 ciphertext sent by the counterparty (clientPub) to the identity.
    const ciphertext = nip04Encrypt(bytesToHex(clientSk), mag.pubkeyHex, plaintext)

    const decReq = await reqEvent(clientSk, mag.pubkeyHex,
      { id: 'n4', method: 'nip04_decrypt', params: [clientPub, ciphertext] })
    const decResp = await s.handleRequestEvent(decReq)
    expect(decResp).not.toBeNull()
    const decrypted = await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, decResp!.content)
    const parsed = JSON.parse(decrypted)
    expect(parsed.result).toBe(plaintext)
    expect(parsed.error).toBeUndefined()
  })

  it('nip04_encrypt stays unsupported — decrypt-only, Lite never creates new NIP-04', async () => {
    const s = signerFromMnemonic(M, ['magazine'], approveAll)
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')

    const encReq = await reqEvent(clientSk, mag.pubkeyHex,
      { id: 'n4e', method: 'nip04_encrypt', params: [clientPub, 'hi'] })
    const encResp = await s.handleRequestEvent(encReq)
    expect(encResp).not.toBeNull()
    const parsed = JSON.parse(await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, encResp!.content))
    expect(parsed.error).toMatch(/unsupported method/)
  })

  it('handleRequestEvent resolves to null when the content is undecryptable garbage', async () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')

    // Build an event that is addressed to the identity but has unparseable content
    const garbageEvent = finalizeEvent(
      { kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', mag.pubkeyHex]], content: 'not-valid-nip44' },
      clientSk,
    )
    const result = await s.handleRequestEvent(garbageEvent)
    expect(result).toBeNull()
  })

  it('ignores stale request events even when they are otherwise valid', async () => {
    const s = signerFromMnemonic(M, ['magazine'], approveAll)
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    const stale = await reqEvent(clientSk, mag.pubkeyHex, { id: 'old', method: 'get_public_key', params: [] })
    stale.created_at = Math.floor(Date.now() / 1000) - (11 * 60)
    expect(await s.handleRequestEvent(stale)).toBeNull()
  })

  it('denies (encrypted error, no signature) when the approve hook returns false', async () => {
    const seen: ApprovalRequest[] = []
    const s = signerFromMnemonic(M, ['magazine'], { approve: async (req) => { seen.push(req); return false } })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    const ev = await reqEvent(clientSk, mag.pubkeyHex,
      { id: '5', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'hi' })] })
    const resp = await s.handleRequestEvent(ev)
    expect(resp).not.toBeNull()
    const parsed = JSON.parse(await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, resp!.content))
    expect(parsed.error).toBe('denied')
    expect(parsed.result).toBeUndefined()
    expect(seen[0]).toMatchObject({ identityName: 'magazine', clientPubkey: clientPub, method: 'sign_event' })
    expect(seen[0].eventDetails).toMatchObject({ kind: 1, createdAt: 0, tags: [], content: 'hi' })
  })

  it('denies sensitive methods when no approve hook is supplied', async () => {
    const s = signerFromMnemonic(M, ['magazine'])  // no opts
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    const ev = await reqEvent(clientSk, mag.pubkeyHex,
      { id: '6', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'hi' })] })
    const resp = await s.handleRequestEvent(ev)
    const parsed = JSON.parse(await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, resp!.content))
    expect(parsed.error).toBe('denied')
    expect(parsed.result).toBeUndefined()
  })

  it('removeIdentity() excludes the identity from listIdentities and makes its requests return null', async () => {
    const s = signerFromMnemonic(M, ['magazine', 'meme'])
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    // Confirm magazine is reachable before removal.
    const before = await s.handleRequestEvent(await signReq(clientSk, mag.pubkeyHex, { id: '1', method: 'get_public_key', params: [] }))
    expect(before).not.toBeNull()

    s.removeIdentity('magazine')

    expect(s.listIdentities().map(i => i.name)).toEqual(['meme'])
    // A request addressed to magazine's pubkey now returns null.
    const after = await s.handleRequestEvent(await signReq(clientSk, mag.pubkeyHex, { id: '2', method: 'get_public_key', params: [] }))
    expect(after).toBeNull()
  })

  it('removeIdentity() is a no-op for an unknown name', () => {
    const s = signerFromMnemonic(M, ['magazine'])
    expect(() => s.removeIdentity('nonexistent')).not.toThrow()
    expect(s.listIdentities()).toHaveLength(1)
  })

  it('removeIdentity() invalidates any active bunker secret, so re-adding the identity does not resurrect it', async () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const { secret } = s.enableBunker('magazine')

    s.removeIdentity('magazine')
    s.addIdentity('magazine') // re-derives the SAME pubkeyHex from the seed

    const clientSk = generateSecretKey()
    const connectEv = await signReq(clientSk, mag.pubkeyHex, { id: 'c', method: 'connect', params: [mag.pubkeyHex, secret] })
    expect(await s.handleRequestEvent(connectEv)).toBeNull()
  })

  it('revoke() removes a paired client so its requests are rejected', async () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    // Before revoke: a request is handled (non-null response).
    const before = await s.handleRequestEvent(await signReq(clientSk, mag.pubkeyHex, { id: '1', method: 'get_public_key', params: [] }))
    expect(before).not.toBeNull()
    s.revoke(clientPub)
    const after = await s.handleRequestEvent(await signReq(clientSk, mag.pubkeyHex, { id: '2', method: 'get_public_key', params: [] }))
    expect(after).toBeNull()
  })

  it('authorises an unapproved client via a connect with the active bunker secret, then signs', async () => {
    const connected: string[] = []
    const s = signerFromMnemonic(M, ['magazine'], { onConnect: (_name, pk) => { connected.push(pk) } })
    const mag = deriveIdentity(M, 'magazine')
    const { secret } = s.enableBunker('magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)

    // Unapproved client connects with the secret → authorised. The bunker:// connect response is
    // "ack" (NOT the secret echoed): the secret authorises the connect but is not returned, per
    // NIP-46. A strict client such as rust-nostr's NostrConnect (Cambium) requires exactly "ack"
    // and rejects a secret echo, so this must stay "ack" or bunker pairing with Cambium breaks.
    const connectEv = await signReq(clientSk, mag.pubkeyHex, { id: 'c', method: 'connect', params: [mag.pubkeyHex, secret] })
    const ack = await s.handleRequestEvent(connectEv)
    expect(ack).not.toBeNull()
    expect(connected).toEqual([clientPub])
    const ackParsed = JSON.parse(await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, ack!.content))
    expect(ackParsed.result).toBe('ack')
    expect(ackParsed.result).not.toBe(secret)

    // Now signing works.
    const signEv = await signReq(clientSk, mag.pubkeyHex, { id: 'g', method: 'get_public_key', params: [] })
    expect(await s.handleRequestEvent(signEv)).not.toBeNull()
  })

  it('consumes a bunker secret after the first successful client connect', async () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const { secret } = s.enableBunker('magazine')
    const firstSk = generateSecretKey()
    const secondSk = generateSecretKey()

    const firstConnect = await signReq(firstSk, mag.pubkeyHex, { id: 'c1', method: 'connect', params: [mag.pubkeyHex, secret] })
    expect(await s.handleRequestEvent(firstConnect)).not.toBeNull()

    const secondConnect = await signReq(secondSk, mag.pubkeyHex, { id: 'c2', method: 'connect', params: [mag.pubkeyHex, secret] })
    expect(await s.handleRequestEvent(secondConnect)).toBeNull()
  })

  it('rejects an unapproved client with a wrong/absent secret', async () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    s.enableBunker('magazine')
    const clientSk = generateSecretKey()
    const badConnect = await signReq(clientSk, mag.pubkeyHex, { id: 'c', method: 'connect', params: [mag.pubkeyHex, 'wrong'] })
    expect(await s.handleRequestEvent(badConnect)).toBeNull()
    // And a non-connect from an unapproved client is never processed.
    const sign = await signReq(clientSk, mag.pubkeyHex, { id: 'g', method: 'get_public_key', params: [] })
    expect(await s.handleRequestEvent(sign)).toBeNull()
  })

  it('rejects a same-length wrong secret (exercises the constant-time compare, not just a length mismatch)', async () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const { secret } = s.enableBunker('magazine')
    // Flip the last hex character — same length as the real secret, still wrong.
    const almostRight = secret.slice(0, -1) + (secret.at(-1) === '0' ? '1' : '0')
    const clientSk = generateSecretKey()
    const badConnect = await signReq(clientSk, mag.pubkeyHex, { id: 'c', method: 'connect', params: [mag.pubkeyHex, almostRight] })
    expect(await s.handleRequestEvent(badConnect)).toBeNull()
  })

  it('revokes a bunker-authorised client if the connect callback fails', async () => {
    const s = signerFromMnemonic(M, ['magazine'], {
      onConnect: async () => { throw new Error('persist failed') },
    })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey()
    const { secret } = s.enableBunker('magazine')

    const connectEv = await signReq(clientSk, mag.pubkeyHex, { id: 'c', method: 'connect', params: [mag.pubkeyHex, secret] })
    await expect(s.handleRequestEvent(connectEv)).resolves.toBeNull()

    const getKeyEv = await signReq(clientSk, mag.pubkeyHex, { id: 'g', method: 'get_public_key', params: [] })
    await expect(s.handleRequestEvent(getKeyEv)).resolves.toBeNull()
  })

  it('authorize() re-grants a client (restore-on-unlock path)', async () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    s.authorize('magazine', clientPub)
    const sign = await signReq(clientSk, mag.pubkeyHex, { id: 'g', method: 'get_public_key', params: [] })
    expect(await s.handleRequestEvent(sign)).not.toBeNull()
  })

  it('rejects a connect when no bunker was enabled for the identity', async () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey()
    // No enableBunker() call → no active secret.
    const connectEv = await signReq(clientSk, mag.pubkeyHex, { id: 'c', method: 'connect', params: [mag.pubkeyHex, 'anything'] })
    expect(await s.handleRequestEvent(connectEv)).toBeNull()
  })

  // ── Approval-gate scoping tests (TDD for fix-switch-relays) ────────────────

  it('get_public_key with deny-all approve hook: hook is NOT called and result is the pubkey', async () => {
    let hookCalled = false
    const s = signerFromMnemonic(M, ['magazine'], { approve: async () => { hookCalled = true; return false } })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    const ev = await reqEvent(clientSk, mag.pubkeyHex, { id: 'gpk1', method: 'get_public_key', params: [] })
    const resp = await s.handleRequestEvent(ev)
    expect(hookCalled).toBe(false)
    expect(resp).not.toBeNull()
    const parsed = JSON.parse(await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, resp!.content))
    expect(parsed.result).toBe(mag.pubkeyHex)
    expect(parsed.error).toBeUndefined()
  })

  it('switch_relays with deny-all approve hook: hook is NOT called and result is null', async () => {
    let hookCalled = false
    const s = signerFromMnemonic(M, ['magazine'], { approve: async () => { hookCalled = true; return false } })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    const ev = await reqEvent(clientSk, mag.pubkeyHex, { id: 'sr1', method: 'switch_relays', params: ['wss://other.relay'] })
    const resp = await s.handleRequestEvent(ev)
    expect(hookCalled).toBe(false)
    expect(resp).not.toBeNull()
    const parsed = JSON.parse(await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, resp!.content))
    // Result is JSON null (not the string 'ack') to match My Signet's response shape.
    expect(parsed.result).toBeNull()
    expect(parsed.error).toBeUndefined()
  })

  it('sign_event with deny-all approve hook: hook IS called and response error is "denied"', async () => {
    let hookCalled = false
    const s = signerFromMnemonic(M, ['magazine'], { approve: async () => { hookCalled = true; return false } })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    const ev = await reqEvent(clientSk, mag.pubkeyHex,
      { id: 'se1', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'hi' })] })
    const resp = await s.handleRequestEvent(ev)
    expect(hookCalled).toBe(true)
    expect(resp).not.toBeNull()
    const parsed = JSON.parse(await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, resp!.content))
    expect(parsed.error).toBe('denied')
    expect(parsed.result).toBeUndefined()
  })

  it('full bunker handshake: connect with secret → sign_event → signed event is valid and authored by the identity', async () => {
    const s = signerFromMnemonic(M, ['magazine'], approveAll)
    const mag = deriveIdentity(M, 'magazine')
    const { secret } = s.enableBunker('magazine')

    // Fresh client: no prior pairing
    const clientSk = generateSecretKey()

    // Step 1: unapproved client sends connect with the secret → receives ack
    const connectEv = await signReq(clientSk, mag.pubkeyHex, {
      id: 'conn-1',
      method: 'connect',
      params: [mag.pubkeyHex, secret],
    })
    const ack = await s.handleRequestEvent(connectEv)
    expect(ack).not.toBeNull()

    // Step 2: now authorised — send sign_event for a kind-1 template
    const template = JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'bunker e2e' })
    const signEv = await signReq(clientSk, mag.pubkeyHex, {
      id: 'sign-1',
      method: 'sign_event',
      params: [template],
    })
    const resp = await s.handleRequestEvent(signEv)
    expect(resp).not.toBeNull()

    // Step 3: decrypt the NIP-46 response and verify the signed event inside
    const plain = await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, resp!.content)
    const parsed = JSON.parse(plain) as { id: string; result?: string; error?: string }
    expect(parsed.error).toBeUndefined()
    expect(parsed.result).toBeTruthy()

    const signed = JSON.parse(parsed.result!)
    expect(verifyEvent(signed)).toBe(true)
    expect(signed.pubkey).toBe(mag.pubkeyHex)
  })
})

describe('Signer activity log (onActivity)', () => {
  function collector() {
    const events: { identityName: string; clientPubkey: string; method: string; kind?: number; outcome: string; auto: boolean; rateLimited: boolean; timedOut?: boolean; errorCode?: string }[] = []
    return { events, onActivity: (e: typeof events[number]) => events.push(e) }
  }

  it('records a successful sign_event with its kind and outcome "signed"', async () => {
    const { events, onActivity } = collector()
    const s = signerFromMnemonic(M, ['magazine'], { ...approveAll, onActivity })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    await s.handleRequestEvent(await reqEvent(clientSk, mag.pubkeyHex,
      { id: '1', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'hi' })] }))
    expect(events).toEqual([{ identityName: 'magazine', clientPubkey: clientPub, method: 'sign_event', kind: 1, outcome: 'signed', auto: false, rateLimited: false }])
  })

  it('carries the approve hook\'s auto/rateLimited flags into the activity event', async () => {
    const { events, onActivity } = collector()
    const s = signerFromMnemonic(M, ['magazine'], { approve: async () => ({ ok: true, auto: true, rateLimited: false }), onActivity })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    await s.handleRequestEvent(await reqEvent(clientSk, mag.pubkeyHex,
      { id: '1', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'hi' })] }))
    expect(events[0]).toMatchObject({ outcome: 'signed', auto: true, rateLimited: false })
  })

  it('records outcome "denied" when the approve hook refuses', async () => {
    const { events, onActivity } = collector()
    const s = signerFromMnemonic(M, ['magazine'], { approve: async () => false, onActivity })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    await s.handleRequestEvent(await reqEvent(clientSk, mag.pubkeyHex,
      { id: '1', method: 'sign_event', params: [JSON.stringify({ kind: 7, created_at: 0, tags: [], content: '+' })] }))
    expect(events).toEqual([{ identityName: 'magazine', clientPubkey: clientPub, method: 'sign_event', kind: 7, outcome: 'denied', auto: false, rateLimited: false }])
  })

  it('flags a denial as timedOut when the prompt is never answered, and still returns "denied"', async () => {
    const { events, onActivity } = collector()
    const s = signerFromMnemonic(M, ['magazine'], { approve: async () => ({ ok: false, timedOut: true }), onActivity })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    const resp = await s.handleRequestEvent(await reqEvent(clientSk, mag.pubkeyHex,
      { id: '1', method: 'sign_event', params: [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'hi' })] }))
    expect(events).toEqual([{ identityName: 'magazine', clientPubkey: clientPub, method: 'sign_event', kind: 1, outcome: 'denied', auto: false, rateLimited: false, timedOut: true }])
    // A timeout still produces a real NIP-46 response so the client stops waiting on the signer.
    expect(resp).not.toBeNull()
  })

  it('records outcome "error" when an approved client sends a malformed template', async () => {
    const { events, onActivity } = collector()
    const s = signerFromMnemonic(M, ['magazine'], { ...approveAll, onActivity })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    await s.handleRequestEvent(await reqEvent(clientSk, mag.pubkeyHex, { id: '1', method: 'sign_event', params: [] }))
    expect(events).toEqual([{ identityName: 'magazine', clientPubkey: clientPub, method: 'sign_event', kind: undefined, outcome: 'error', auto: false, rateLimited: false, errorCode: 'missing event template' }])
  })

  it('records get_public_key (a benign read) with outcome "signed" and no kind', async () => {
    const { events, onActivity } = collector()
    const s = signerFromMnemonic(M, ['magazine'], { onActivity })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    await s.handleRequestEvent(await reqEvent(clientSk, mag.pubkeyHex, { id: '1', method: 'get_public_key', params: [] }))
    expect(events).toEqual([{ identityName: 'magazine', clientPubkey: clientPub, method: 'get_public_key', kind: undefined, outcome: 'signed', auto: false, rateLimited: false }])
  })

  it('does NOT record transport/no-op methods (ping, connect, switch_relays)', async () => {
    const { events, onActivity } = collector()
    const s = signerFromMnemonic(M, ['magazine'], { ...approveAll, onActivity })
    const mag = deriveIdentity(M, 'magazine')
    const clientSk = generateSecretKey(); const clientPub = getPublicKey(clientSk)
    await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')
    await s.handleRequestEvent(await reqEvent(clientSk, mag.pubkeyHex, { id: '1', method: 'ping', params: [] }))
    await s.handleRequestEvent(await reqEvent(clientSk, mag.pubkeyHex, { id: '2', method: 'connect', params: [] }))
    await s.handleRequestEvent(await reqEvent(clientSk, mag.pubkeyHex, { id: '3', method: 'switch_relays', params: ['wss://x'] }))
    expect(events).toEqual([])
  })

  it('does NOT record events that are unaddressed or undecryptable', async () => {
    const { events, onActivity } = collector()
    const s = signerFromMnemonic(M, ['magazine'], { ...approveAll, onActivity })
    const mag = deriveIdentity(M, 'magazine')
    const strangerSk = generateSecretKey()
    // Never paired → request ignored, nothing logged.
    await s.handleRequestEvent(await reqEvent(strangerSk, mag.pubkeyHex, { id: '1', method: 'get_public_key', params: [] }))
    // Addressed but undecryptable content → nothing logged.
    await s.handleRequestEvent(finalizeEvent(
      { kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', mag.pubkeyHex]], content: 'not-valid-nip44' }, strangerSk))
    expect(events).toEqual([])
  })
})

describe('Signer construction', () => {
  it('builds from a resolved-identity list and signs with that key', () => {
    const mag = deriveIdentity(M, 'magazine')
    const s = new Signer([mag])
    expect(s.listIdentities().map(i => i.name)).toEqual(['magazine'])
    const signed = s.signEventAs('magazine', { kind: 0, content: '{}' })
    expect(signed.pubkey).toBe(mag.pubkeyHex)
  })

  it('addIdentity throws when no deriver was supplied', () => {
    const mag = deriveIdentity(M, 'magazine')
    const s = new Signer([mag])
    expect(() => s.addIdentity('meme')).toThrow(/cannot derive/)
  })

  it('signerFromMnemonic derives names and supports addIdentity', () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const meme = deriveIdentity(M, 'meme')
    const added = s.addIdentity('meme')
    expect(added.npub).toBe(meme.npub)
    expect(s.listIdentities().map(i => i.name).sort()).toEqual(['magazine', 'meme'])
  })

  it('destroy drops identities and disables future derivation', () => {
    const s = signerFromMnemonic(M, ['magazine'])
    s.destroy()
    expect(s.listIdentities()).toEqual([])
    expect(() => s.addIdentity('meme')).toThrow(/cannot derive/)
  })
})

describe('signerFromNsec', () => {
  it('materialises the root as the raw key and resolves a derived child', () => {
    const child = deriveChildFromNsec(NSEC, 'work')
    const s = signerFromNsec(NSEC, [
      { name: 'main', derivation: 'root' },
      { name: 'work', derivation: 'derived' },
    ])
    const ids = s.listIdentities()
    expect(ids.find(i => i.name === 'main')!.npub).toBe(NPUB)
    expect(ids.find(i => i.name === 'work')!.pubkeyHex).toBe(child.pubkeyHex)
  })

  it('addIdentity mints a fromNsec child', () => {
    const s = signerFromNsec(NSEC, [{ name: 'main', derivation: 'root' }])
    const expected = deriveChildFromNsec(NSEC, 'work')
    const added = s.addIdentity('work')
    expect(added.npub).toBe(expected.npub)
    expect(added.npub).not.toBe(NPUB)
  })

  it('addIdentity rejects the root name, leaving the root key in place (audit M2)', () => {
    const s = signerFromNsec(NSEC, [{ name: 'default', derivation: 'root' }])
    expect(() => s.addIdentity('default')).toThrow(/already exists/)
    expect(s.listIdentities()).toHaveLength(1)
    expect(s.listIdentities()[0].npub).toBe(NPUB)
  })
})

describe('Signer.addIdentity duplicate names (audit M2)', () => {
  it('rejects a name that already exists', () => {
    const s = signerFromMnemonic(M, ['magazine'])
    const before = s.listIdentities()
    expect(() => s.addIdentity('magazine')).toThrow(/already exists/)
    expect(s.listIdentities()).toEqual(before)
  })

  it('matches names case-sensitively', () => {
    const s = signerFromMnemonic(M, ['magazine'])
    expect(() => s.addIdentity('Magazine')).not.toThrow()
    expect(s.listIdentities()).toHaveLength(2)
  })
})
