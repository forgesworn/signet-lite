import { describe, it, expect } from 'vitest'
import { SUPPORTED_METHODS } from './nip46.js'
import { signerFromMnemonic } from './signer.js'
import { deriveIdentity } from './derive.js'
import { nip44Decrypt, nip44Encrypt } from './nip46.js'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { bytesToHex } from 'nostr-tools/utils'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const approveAll = { approve: async () => true }

/** Build a NIP-44-encrypted kind-24133 request from a client to an identity. */
async function reqEvent(clientSk: Uint8Array, identityPubHex: string, body: object) {
  const clientHex = bytesToHex(clientSk)
  const content = await nip44Encrypt(clientHex, identityPubHex, JSON.stringify(body))
  return finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', identityPubHex]], content }, clientSk)
}

/** Minimal valid params per method. */
function validParamsFor(method: string): string[] {
  const clientPub = bytesToHex(generateSecretKey())
  switch (method) {
    case 'sign_event':
      return [JSON.stringify({ kind: 1, created_at: 0, tags: [], content: 'conformance' })]
    case 'nip44_encrypt':
      return [clientPub, 'hello']
    case 'nip44_decrypt': {
      // We need a real ciphertext; use a placeholder pubkey -- the signer will
      // attempt to decrypt and may error with "invalid ciphertext" but NOT
      // "unsupported method", which is all this test asserts.
      return [clientPub, 'placeholder']
    }
    case 'switch_relays':
      return ['wss://other.relay']
    default:
      return []
  }
}

/**
 * Build a fresh paired signer and submit one decrypted request body,
 * returning the parsed { result, error } from the NIP-46 response.
 */
async function submitRequest(method: string, params: string[]): Promise<{ result?: unknown; error?: string }> {
  const s = signerFromMnemonic(M, ['magazine'], approveAll)
  const mag = deriveIdentity(M, 'magazine')
  const clientSk = generateSecretKey()
  const clientPub = getPublicKey(clientSk)

  await s.pair(`nostrconnect://${clientPub}?relay=wss%3A%2F%2Fr&secret=x`, 'magazine')

  const ev = await reqEvent(clientSk, mag.pubkeyHex, { id: 'c1', method, params })
  const resp = await s.handleRequestEvent(ev)
  if (!resp) return { error: 'no response event' }

  const decrypted = await nip44Decrypt(bytesToHex(clientSk), mag.pubkeyHex, resp.content)
  return JSON.parse(decrypted) as { result?: unknown; error?: string }
}

describe('NIP-46 conformance: advertised methods match runtime', () => {
  for (const method of SUPPORTED_METHODS) {
    it(`handles advertised method ${method} without "unsupported method"`, async () => {
      const { error } = await submitRequest(method, validParamsFor(method))
      expect(error ?? '').not.toMatch(/unsupported method/i)
    })
  }

  it('rejects an unadvertised method', async () => {
    const { error } = await submitRequest('definitely_not_a_method', [])
    expect(error ?? '').toMatch(/unsupported method/i)
  })

  it('switch_relays result is JSON null (not the string "ack")', async () => {
    const { result, error } = await submitRequest('switch_relays', ['wss://other.relay'])
    expect(error).toBeUndefined()
    expect(result).toBeNull()
  })
})
