/**
 * Direct SDK compatibility check for published signet-login clients.
 *
 * This spec is skipped in the normal suite because signet-login is not a repo
 * dependency. CI enables it after installing signet-login@latest without
 * touching package.json or package-lock.json.
 */

import { describe, it, expect } from 'vitest'
import type { Event as NostrEvent, EventTemplate } from 'nostr-tools'
import type { startRelay } from '../../e2e/local-relay.js'
import type { Signer } from './signer.js'
import type { SignerRelay } from './relay.js'

const RUN_SDK_COMPAT = process.env.SIGNET_LOGIN_COMPAT === '1'
const sdkDescribe = RUN_SDK_COMPAT ? describe : describe.skip

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const EXPECTED_PUBKEY = '669452f36131312d1932b63cc0695b3861a15105dfeb13781ed1af5b8aff6dc5'

type SignetBunkerSigner = {
  pubkey: string
  signEvent(template: EventTemplate): Promise<NostrEvent>
  close(): Promise<void>
  nip44?: {
    encrypt(peerPubkey: string, plaintext: string): Promise<string>
    decrypt(peerPubkey: string, ciphertext: string): Promise<string>
  }
  nip46?: {
    ping(): Promise<void>
    switchRelays(): Promise<boolean>
  }
}

type SignetLoginSdk = {
  createBunkerSigner(input: {
    uri: string
    clientSecretKey?: Uint8Array
    timeoutMs?: number
  }): Promise<SignetBunkerSigner>
  createBunkerSignerFromNostrConnect(input: {
    uri: string
    clientSecretKey: Uint8Array
    abortSignal?: AbortSignal
    timeoutMs?: number
  }): Promise<SignetBunkerSigner>
  buildNostrConnectUri(input: {
    clientPubkeyHex: string
    relayUrl?: string
    relayUrls?: string[]
    secret: string
    perms?: string[]
    appName?: string
    appUrl?: string
  }): string
  generateSecretKey(): Uint8Array
}

type CompatFixture = {
  relay: Awaited<ReturnType<typeof startRelay>>
  signer: Signer
  signerRelay: SignerRelay
}

type CompatModules = {
  startRelay: typeof import('../../e2e/local-relay.js').startRelay
  signerFromMnemonic: typeof import('./signer.js').signerFromMnemonic
  SignerRelay: typeof import('./relay.js').SignerRelay
  createSimplePool: typeof import('./relay.js').createSimplePool
  deriveIdentity: typeof import('./derive.js').deriveIdentity
  getPublicKey: typeof import('nostr-tools/pure').getPublicKey
  verifyEvent: typeof import('nostr-tools/pure').verifyEvent
}

let compatModulesPromise: Promise<CompatModules> | undefined

async function loadCompatModules(): Promise<CompatModules> {
  compatModulesPromise ??= (async () => {
    const [
      wsModule,
      poolModule,
      pureModule,
      relayServerModule,
      signerModule,
      relayModule,
      deriveModule,
    ] = await Promise.all([
      import('ws'),
      import('nostr-tools/pool'),
      import('nostr-tools/pure'),
      import('../../e2e/local-relay.js'),
      import('./signer.js'),
      import('./relay.js'),
      import('./derive.js'),
    ])

    const nodeWebSocket = wsModule.default as unknown as typeof globalThis.WebSocket
    globalThis.WebSocket = nodeWebSocket
    poolModule.useWebSocketImplementation(nodeWebSocket)

    return {
      startRelay: relayServerModule.startRelay,
      signerFromMnemonic: signerModule.signerFromMnemonic,
      SignerRelay: relayModule.SignerRelay,
      createSimplePool: relayModule.createSimplePool,
      deriveIdentity: deriveModule.deriveIdentity,
      getPublicKey: pureModule.getPublicKey,
      verifyEvent: pureModule.verifyEvent,
    }
  })()

  return compatModulesPromise
}

async function loadSignetLogin(): Promise<SignetLoginSdk> {
  await loadCompatModules()

  const packageName = ['signet', 'login'].join('-')
  try {
    return await import(/* @vite-ignore */ packageName) as unknown as SignetLoginSdk
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`signet-login is required for SDK compatibility tests: ${detail}`)
  }
}

async function startCompatFixture(): Promise<CompatFixture> {
  const { startRelay, deriveIdentity, signerFromMnemonic, SignerRelay, createSimplePool } = await loadCompatModules()
  const relay = await startRelay()
  const identity = deriveIdentity(MNEMONIC, 'default')
  const signer = signerFromMnemonic(MNEMONIC, ['default'], { approve: async () => true })
  const signerRelay = new SignerRelay(signer, [relay.url], createSimplePool())

  signerRelay.start([identity.pubkeyHex])
  await sleep(300)

  return { relay, signer, signerRelay }
}

async function stopCompatFixture(fixture: CompatFixture): Promise<void> {
  fixture.signerRelay.stop()
  fixture.signer.destroy()
  await fixture.relay.close().catch(() => {})
}

function randomHex32(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function expectUsableSigner(client: SignetBunkerSigner, content: string): Promise<void> {
  const { verifyEvent } = await loadCompatModules()

  expect(client.pubkey).toBe(EXPECTED_PUBKEY)

  const signed = await client.signEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content,
  })

  expect(verifyEvent(signed)).toBe(true)
  expect(signed.pubkey).toBe(EXPECTED_PUBKEY)
  expect(signed.content).toBe(content)

  await expect(client.nip46?.ping()).resolves.toBeUndefined()
  await expect(client.nip46?.switchRelays()).resolves.toBe(false)

  expect(client.nip44).toBeDefined()
  const plaintext = 'signet-login sdk nip44 round-trip'
  const ciphertext = await client.nip44!.encrypt(client.pubkey, plaintext)
  expect(typeof ciphertext).toBe('string')
  expect(ciphertext.length).toBeGreaterThan(0)
  await expect(client.nip44!.decrypt(client.pubkey, ciphertext)).resolves.toBe(plaintext)
}

sdkDescribe('signet-login SDK compatibility: Lite bunker signer', () => {
  it(
    'connects through createBunkerSigner and completes the signing + NIP-44 contract',
    async () => {
      const sdk = await loadSignetLogin()
      const fixture = await startCompatFixture()
      const { pubkeyHex, secret } = fixture.signer.enableBunker('default')
      const uri = `bunker://${pubkeyHex}?relay=${encodeURIComponent(fixture.relay.url)}&secret=${secret}`
      let client: SignetBunkerSigner | undefined

      try {
        client = await sdk.createBunkerSigner({ uri, timeoutMs: 8_000 })
        await expectUsableSigner(client, 'signet-login sdk bunker compat')
      } finally {
        await client?.close().catch(() => {})
        await stopCompatFixture(fixture)
      }
    },
    25_000,
  )

  it(
    'connects through createBunkerSignerFromNostrConnect and keeps the paired client usable',
    async () => {
      const sdk = await loadSignetLogin()
      const { getPublicKey } = await loadCompatModules()
      const fixture = await startCompatFixture()
      const clientSecretKey = sdk.generateSecretKey()
      const clientPubkeyHex = getPublicKey(clientSecretKey)
      const uri = sdk.buildNostrConnectUri({
        clientPubkeyHex,
        relayUrls: [fixture.relay.url],
        secret: randomHex32(),
        perms: ['sign_event', 'nip44_encrypt', 'nip44_decrypt'],
        appName: 'signet-login sdk compat',
      })
      let client: SignetBunkerSigner | undefined

      try {
        const clientPromise = sdk.createBunkerSignerFromNostrConnect({
          uri,
          clientSecretKey,
          timeoutMs: 8_000,
        })

        await sleep(300)
        const { clientPubkey, connectResponse } = await fixture.signer.pair(uri, 'default')
        expect(clientPubkey).toBe(clientPubkeyHex)
        fixture.signerRelay.publish(connectResponse)

        client = await clientPromise
        await expectUsableSigner(client, 'signet-login sdk nostrconnect compat')
      } finally {
        await client?.close().catch(() => {})
        await stopCompatFixture(fixture)
      }
    },
    25_000,
  )
})
