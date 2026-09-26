/**
 * Full NIP-46 nostrconnect handshake E2E test (client-initiated direction).
 *
 * The reverse of bunker-full.spec.ts: here a real client (nostr-tools
 * BunkerSigner) generates the `nostrconnect://` URI, and Signet Lite is the
 * party that pairs by pasting the link and approving. Proves that Lite can
 * complete the client-initiated handshake over a local relay and return a
 * signature that verifies against the identity's public key.
 */
import { test, expect } from '@playwright/test'
import WebSocket from 'ws'
import { useWebSocketImplementation } from 'nostr-tools/pool'
import { createNostrConnectURI, BunkerSigner } from 'nostr-tools/nip46'
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { startRelay } from './local-relay.js'
import { importIdentity } from './helpers.js'

// Install the ws WebSocket implementation so nostr-tools pool works in Node.
useWebSocketImplementation(WebSocket as unknown as typeof globalThis.WebSocket)

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// Pre-computed expected pubkey: deriveIdentity(ABANDON, 'default').pubkeyHex
// (same vector as bunker-full.spec.ts — the 'default' identity).
const EXPECTED_PUBKEY = '669452f36131312d1932b63cc0695b3861a15105dfeb13781ed1af5b8aff6dc5'

/** A random 32-byte hex string — the one-time pairing secret. */
function randomHex32(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

test('nostrconnect-full: real client generates URI → Lite pairs + signs', async ({ page }) => {
  test.setTimeout(60_000)
  const relay = await startRelay()
  console.error('[test] local relay started at', relay.url)

  let client: BunkerSigner | undefined

  try {
    // ── Step 1: Client builds the nostrconnect:// URI ────────────────────────
    const clientSk = generateSecretKey()
    const clientPub = getPublicKey(clientSk)
    const secret = randomHex32()
    const uri = createNostrConnectURI({
      clientPubkey: clientPub,
      relays: [relay.url],
      secret,
      name: 'e2e client',
    })
    console.error('[test] nostrconnect URI:', uri)
    expect(uri).toMatch(/^nostrconnect:\/\//)

    // ── Step 2: Kick off the client listener BEFORE Lite pairs ───────────────
    // fromURI subscribes to the relay and resolves once Lite publishes a connect
    // ack whose decrypted result echoes the secret. maxWait keeps the subscription
    // alive long enough for the manual UI steps.
    // Note: switch_relays is now handled gracefully (no-op ack, no approve prompt),
    // so no skipSwitchRelays workaround is needed.
    const signerP = BunkerSigner.fromURI(
      clientSk,
      uri,
      {},
      45_000,
    )
    // Surface a rejection rather than leaving it as an unhandled promise while we
    // drive the UI. We re-await the real promise below.
    signerP.catch((e: unknown) => console.error('[test] fromURI rejected:', e))

    // ── Step 3: Lite imports the identity ────────────────────────────────────
    await importIdentity(page, 'default', ABANDON)
    await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()

    // ── Step 4: Lite pastes the link and confirms ────────────────────────────
    await page.getByRole('button', { name: /connect an app/i }).click()
    await page.getByRole('button', { name: /scan or paste a link/i }).click()
    await page.getByLabel('Connection link').fill(uri)
    await page.getByRole('button', { name: /continue/i }).click()
    console.error('[test] clicking Connect-as on the confirm screen...')
    await page.getByRole('button', { name: /connect as default/i }).click()
    // A success screen now follows the pairing; tap Done to return Home.
    await page.getByRole('button', { name: /^done$/i }).click()
    await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()

    // ── Step 5: Client receives the ack ──────────────────────────────────────
    console.error('[test] awaiting fromURI (connect ack)...')
    const signer = await signerP
    client = signer
    console.error('[test] fromURI resolved — handshake complete')

    // ── Step 6: New apps ask before actions by default.
    const tmpl = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [] as string[][],
      content: 'hello from a real nostrconnect client',
    }
    console.error('[test] signing kind 1 — expecting an approval prompt...')
    const signP = signer.signEvent(tmpl)
    const approveBtn = page.getByRole('button', { name: /^approve$/i })
    await expect(approveBtn).toBeVisible({ timeout: 20_000 })
    await approveBtn.click()
    const signed = await signP
    console.error('[test] signed event:', JSON.stringify(signed))

    // Profile (kind 0) writes also prompt by default; deny this one.
    console.error('[test] signing kind 0 — expecting an approval prompt...')
    const profileP = signer.signEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: '{"name":"hijack"}' })
    const denyBtn = page.getByRole('button', { name: /^deny$/i })
    // Attach the rejection expectation before clicking: the denial can arrive while click() is
    // still settling, and an unobserved rejection fails the test.
    const profileDenied = expect(profileP).rejects.toBeTruthy()
    await expect(denyBtn).toBeVisible({ timeout: 20_000 })
    await denyBtn.click()
    await profileDenied

    // ── Step 7: Assert ───────────────────────────────────────────────────────
    const valid = verifyEvent(signed)
    console.error('[test] verifyEvent result:', valid)
    console.error('[test] signed.pubkey:', signed.pubkey)
    console.error('[test] expected pubkey:', EXPECTED_PUBKEY)

    expect(valid).toBe(true)
    expect(signed.pubkey).toBe(EXPECTED_PUBKEY)
    expect(signed.content).toBe('hello from a real nostrconnect client')
    expect(signed.kind).toBe(1)

  } finally {
    await client?.close().catch((e: unknown) => { console.error('[test] client.close error:', e) })
    await relay.close()
    console.error('[test] relay closed')
  }
})

test('nostrconnect ask-each-time: ticking the box keeps per-request prompts', async ({ page }) => {
  test.setTimeout(60_000)
  const relay = await startRelay()
  let client: BunkerSigner | undefined
  try {
    const clientSk = generateSecretKey()
    const clientPub = getPublicKey(clientSk)
    const secret = randomHex32()
    const uri = createNostrConnectURI({ clientPubkey: clientPub, relays: [relay.url], secret, name: 'e2e client' })
    const signerP = BunkerSigner.fromURI(clientSk, uri, {}, 45_000)
    signerP.catch((e: unknown) => console.error('[test] fromURI rejected:', e))

    await importIdentity(page, 'default', ABANDON)
    await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()

    await page.getByRole('button', { name: /connect an app/i }).click()
    await page.getByRole('button', { name: /scan or paste a link/i }).click()
    await page.getByLabel('Connection link').fill(uri)
    await page.getByRole('button', { name: /continue/i }).click()
    await page.getByLabel(/ask before each action/i).check()
    await page.getByRole('button', { name: /connect as default/i }).click()
    // A success screen now follows the pairing; tap Done to return Home.
    await page.getByRole('button', { name: /^done$/i }).click()
    await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()

    const signer = await signerP
    client = signer

    const signP = signer.signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'needs approval' })
    const approveBtn = page.getByRole('button', { name: /^approve$/i })
    await expect(approveBtn).toBeVisible({ timeout: 20_000 })
    await approveBtn.click()
    const signed = await signP
    expect(verifyEvent(signed)).toBe(true)
    expect(signed.content).toBe('needs approval')
  } finally {
    await client?.close().catch(() => {})
    await relay.close()
  }
})
