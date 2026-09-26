/**
 * Full NIP-46 bunker handshake E2E test.
 *
 * Proves that a real BunkerSigner (nostr-tools) can connect to a running
 * Signet Lite instance over a local relay, and receive a valid signature
 * that verifies against the identity's public key.
 */
import { test, expect } from '@playwright/test'
import WebSocket from 'ws'
import { useWebSocketImplementation } from 'nostr-tools/pool'
import { parseBunkerInput, BunkerSigner } from 'nostr-tools/nip46'
import { generateSecretKey, verifyEvent } from 'nostr-tools/pure'
import { startRelay } from './local-relay.js'
import { importIdentity } from './helpers.js'

// Install the ws WebSocket implementation so nostr-tools pool works in Node
useWebSocketImplementation(WebSocket as unknown as typeof globalThis.WebSocket)

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// Pre-computed expected pubkey: deriveIdentity(ABANDON, 'default').pubkeyHex
// Verified via: node -e "import nsec-tree; derive(fromMnemonic(ABANDON), 'default', 0)"
const EXPECTED_PUBKEY = '669452f36131312d1932b63cc0695b3861a15105dfeb13781ed1af5b8aff6dc5'

test('bunker-full: real BunkerSigner handshake → verifiable signature', async ({ page }) => {
  const relay = await startRelay()
  console.error('[test] local relay started at', relay.url)

  let client: BunkerSigner | undefined

  try {
    // ── Step 1: Import identity ──────────────────────────────────────────────
    await importIdentity(page, 'default', ABANDON)
    await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()

    // ── Step 2: Point Lite at the local relay ────────────────────────────────
    // Navigate: gear → Settings → Relays
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await page.getByRole('button', { name: 'Relays' }).click()
    await expect(page.getByRole('heading', { name: 'Relays' })).toBeVisible()

    // Add the local relay so the bunker URI advertises it (default relays are wss:// and
    // won't connect in the test environment, but the BunkerSigner tries all relays in
    // the URI and will reach the local one).
    await page.getByLabel('Add relay').fill(relay.url)
    await page.getByRole('button', { name: 'Add' }).click()
    // Confirm the local relay appears in the list before navigating away
    await expect(page.getByText(relay.url, { exact: true })).toBeVisible()

    // Back to Settings screen (aria-label="Back" on the ← button)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    // Back to Home (the ← button on Settings also has aria-label="Back")
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()

    // ── Step 3: Create a bunker link ─────────────────────────────────────────
    await page.getByRole('button', { name: /connect an app/i }).click()
    await expect(page.getByRole('heading', { name: 'Connect an app' })).toBeVisible()
    await page.getByRole('button', { name: /create a link for an app/i }).click()
    await page.getByRole('button', { name: /^create link$/i }).click()

    const uriElement = page.getByTestId('bunker-uri')
    await expect(uriElement).toBeVisible()
    const bunkerUri = (await uriElement.textContent())!.trim()
    console.error('[test] bunker URI:', bunkerUri)
    expect(bunkerUri).toMatch(/^bunker:\/\//)

    // ── Step 4: Node-side BunkerSigner connects ──────────────────────────────
    const bp = await parseBunkerInput(bunkerUri)
    if (!bp) throw new Error(`parseBunkerInput returned null for: ${bunkerUri}`)
    console.error('[test] bunker pointer:', JSON.stringify(bp))

    const clientSk = generateSecretKey()
    client = BunkerSigner.fromBunker(clientSk, bp)

    // connect() sends the secret — Lite authorises automatically (no Approve click needed)
    console.error('[test] calling client.connect()...')
    await client.connect()
    console.error('[test] client.connect() resolved')

    // Lite should now show "Connected to App XXXXX" on the Bunker screen
    // (optional check — the important thing is connect() resolved)
    await expect(page.getByText(/Connected to/)).toBeVisible({ timeout: 10_000 })

    // ── Step 5: Sign an event. Bunker-link connections ask by default, so approve it.
    const template = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [] as string[][],
      content: 'hello from a real app',
    }

    console.error('[test] calling client.signEvent()...')
    const signP = client.signEvent(template)
    const approveBtn = page.getByRole('button', { name: /^approve$/i })
    await expect(approveBtn).toBeVisible({ timeout: 20_000 })
    await approveBtn.click()
    const signed = await signP
    console.error('[test] signed event:', JSON.stringify(signed))

    // ── Step 6: Assert ───────────────────────────────────────────────────────
    const valid = verifyEvent(signed)
    console.error('[test] verifyEvent result:', valid)
    console.error('[test] signed.pubkey:', signed.pubkey)
    console.error('[test] expected pubkey:', EXPECTED_PUBKEY)

    expect(valid).toBe(true)
    expect(signed.pubkey).toBe(EXPECTED_PUBKEY)
    expect(signed.content).toBe('hello from a real app')
    expect(signed.kind).toBe(1)

  } finally {
    await client?.close().catch((e: unknown) => { console.error('[test] client.close error:', e) })
    await relay.close()
    console.error('[test] relay closed')
  }
}, { timeout: 60_000 })
