/**
 * Activity-log E2E.
 *
 * A real BunkerSigner connects over a local relay and signs a kind-1 note. The signature
 * is approved through the prompt, so the engine records an activity entry. The
 * test then opens Settings → Activity and asserts the signing shows up — and that the log
 * shows only metadata, never the note's content.
 */
import { test, expect } from '@playwright/test'
import WebSocket from 'ws'
import { useWebSocketImplementation } from 'nostr-tools/pool'
import { parseBunkerInput, BunkerSigner } from 'nostr-tools/nip46'
import { generateSecretKey } from 'nostr-tools/pure'
import { startRelay } from './local-relay.js'
import { importIdentity } from './helpers.js'

useWebSocketImplementation(WebSocket as unknown as typeof globalThis.WebSocket)

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const SECRET_CONTENT = 'this note body must never reach the activity log'

test('activity: a signed request appears in the log, content never does', async ({ page }) => {
  const relay = await startRelay()
  let client: BunkerSigner | undefined

  try {
    // Import an identity and point Lite at the local relay.
    await importIdentity(page, 'default', ABANDON)
    await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Relays' }).click()
    await page.getByLabel('Add relay').fill(relay.url)
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText(relay.url, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()

    // Create a bunker link.
    await page.getByRole('button', { name: /connect an app/i }).click()
    await page.getByRole('button', { name: /create a link for an app/i }).click()
    await page.getByRole('button', { name: /^create link$/i }).click()
    const bunkerUri = (await page.getByTestId('bunker-uri').textContent())!.trim()

    // A real app connects and signs a note.
    const bp = await parseBunkerInput(bunkerUri)
    if (!bp) throw new Error(`parseBunkerInput returned null for: ${bunkerUri}`)
    client = BunkerSigner.fromBunker(generateSecretKey(), bp)
    await client.connect()
    await expect(page.getByText(/Connected to/)).toBeVisible({ timeout: 10_000 })

    const signP = client.signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: SECRET_CONTENT })
    const approveBtn = page.getByRole('button', { name: /^approve$/i })
    await expect(approveBtn).toBeVisible({ timeout: 20_000 })
    await approveBtn.click()
    await signP

    // Approval returns home; open Settings → Activity.
    await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Activity' }).click()
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()

    // The signed note is recorded exactly once — the signer is idempotent even though the
    // relay re-delivers the request event — and as metadata only.
    await expect(page.getByText('Signed a note')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Signed a note')).toHaveCount(1)
    await expect(page.getByText('Signed', { exact: true })).toBeVisible()
    await expect(page.getByText('Auto', { exact: true })).toHaveCount(0)
    // The note's content must NOT appear anywhere in the activity view.
    await expect(page.getByText(SECRET_CONTENT)).toHaveCount(0)
  } finally {
    await client?.close().catch(() => {})
    await relay.close()
  }
}, { timeout: 60_000 })
