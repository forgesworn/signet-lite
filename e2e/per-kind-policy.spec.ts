/**
 * Per-kind policy E2E.
 *
 * Proves the granular "Always allow": ticking it on a kind-1 sign grants ONLY that kind —
 * a second kind-1 then auto-signs with no prompt, while a different kind (30023) still prompts.
 * Drives a real nostr-tools client against a local relay, the same harness as
 * nostrconnect-full.spec.ts.
 */
import { test, expect } from '@playwright/test'
import WebSocket from 'ws'
import { useWebSocketImplementation } from 'nostr-tools/pool'
import { createNostrConnectURI, BunkerSigner } from 'nostr-tools/nip46'
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { startRelay } from './local-relay.js'
import { importIdentity } from './helpers.js'

useWebSocketImplementation(WebSocket as unknown as typeof globalThis.WebSocket)

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

function randomHex32(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

test('per-kind: "always allow" on a sign grants only that kind', async ({ page }) => {
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

    // New connections ask before actions by default.
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

    // First kind-1: prompt appears. Tick the (per-kind) "always allow", then approve.
    const firstP = signer.signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'note one' })
    const alwaysBox = page.getByLabel(/always allow .* to sign kind-1 events/i)
    await expect(alwaysBox).toBeVisible({ timeout: 20_000 })
    await alwaysBox.check()
    await page.getByRole('button', { name: /^approve$/i }).click()
    const first = await firstP
    expect(verifyEvent(first)).toBe(true)
    expect(first.kind).toBe(1)

    // Second kind-1: auto-signed thanks to the per-kind grant — no prompt. (If it wrongly
    // prompted, signEvent would hang and the test would time out.)
    const second = await signer.signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'note two' })
    expect(verifyEvent(second)).toBe(true)
    expect(second.content).toBe('note two')
    await expect(page.getByRole('button', { name: /^approve$/i })).toHaveCount(0)

    // A different kind still prompts — the grant was kind-1 only, not all signing.
    const longformP = signer.signEvent({ kind: 30023, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'long-form draft' })
    const approveBtn = page.getByRole('button', { name: /^approve$/i })
    await expect(approveBtn).toBeVisible({ timeout: 20_000 })
    await approveBtn.click()
    const longform = await longformP
    expect(verifyEvent(longform)).toBe(true)
    expect(longform.kind).toBe(30023)
  } finally {
    await client?.close().catch(() => {})
    await relay.close()
  }
})
