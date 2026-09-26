// src/engine/nip46.test.ts
import { describe, it, expect } from 'vitest'
import { parseNostrConnectURI, nip44Encrypt, nip44Decrypt, parseNIP46Request, buildNIP46Response, isFreshNIP46Event } from './nip46.js'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes } from 'nostr-tools/utils'

describe('nip46 protocol', () => {
  it('parses a nostrconnect:// URI including its secret', () => {
    const sk = generateSecretKey(); const pk = getPublicKey(sk)
    const uri = `nostrconnect://${pk}?relay=wss%3A%2F%2Frelay.damus.io&secret=abc123&perms=sign_event`
    const req = parseNostrConnectURI(uri)
    expect(req?.clientPubkey).toBe(pk)
    expect(req?.secret).toBe('abc123')
  })
  it('round-trips NIP-44 between two keys', async () => {
    const a = bytesToHex(generateSecretKey()); const b = bytesToHex(generateSecretKey())
    const apub = getPublicKey(hexToBytes(a)); const bpub = getPublicKey(hexToBytes(b))
    const ct = await nip44Encrypt(a, bpub, 'hello')
    expect(await nip44Decrypt(b, apub, ct)).toBe('hello')
  })
  it('parses a request and builds a response', () => {
    const req = parseNIP46Request(JSON.stringify({ id: '1', method: 'get_public_key', params: [] }))
    expect(req?.method).toBe('get_public_key')
    expect(buildNIP46Response('1', 'ok')).toContain('"result":"ok"')
  })
  it('rejects oversized request fields before they reach storage or UI', () => {
    expect(parseNIP46Request(JSON.stringify({ id: 'x'.repeat(129), method: 'get_public_key', params: [] }))).toBeNull()
    expect(parseNIP46Request(JSON.stringify({ id: '1', method: 'x'.repeat(65), params: [] }))).toBeNull()
    expect(parseNIP46Request(JSON.stringify({ id: '1', method: 'sign_event', params: ['x'.repeat(64 * 1024 + 1)] }))).toBeNull()
  })
  it('accepts only recent request-event timestamps', () => {
    expect(isFreshNIP46Event(1000, 1000)).toBe(true)
    expect(isFreshNIP46Event(400, 1000)).toBe(true)
    expect(isFreshNIP46Event(399, 1000)).toBe(false)
    expect(isFreshNIP46Event(1060, 1000)).toBe(true)
    expect(isFreshNIP46Event(1061, 1000)).toBe(false)
  })
})
