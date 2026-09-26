import { test, expect } from '@playwright/test'
import { importIdentity } from './helpers'

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
// A syntactically valid nostrconnect URI (64-hex client pubkey, relay, secret).
// Note: all-decimal pubkeys are normalised to IPv4 by the URL parser, so use a
// letter-containing hex pubkey that the URL parser leaves intact.
const URI = 'nostrconnect://deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef?relay=wss%3A%2F%2Frelay.example&secret=testsecret'

test('paste-connect an app returns to home', async ({ page }) => {
  await importIdentity(page, 'default', ABANDON)
  await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()
  await page.getByRole('button', { name: /connect an app/i }).click()
  // Mode chooser: select paste mode
  await page.getByRole('button', { name: /scan or paste a link/i }).click()
  await page.getByLabel('Connection link').fill(URI)
  await page.getByRole('button', { name: /continue/i }).click()
  await page.getByRole('button', { name: /connect as default/i }).click()
  // Pairing publishes the ack (best-effort to a dead relay) and shows a success screen.
  await expect(page.getByText(/connected to/i)).toBeVisible()
  await page.getByRole('button', { name: /^done$/i }).click()
  await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()
})

test('paste-connect then Manage connected apps opens the list', async ({ page }) => {
  await importIdentity(page, 'default', ABANDON)
  await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()
  await page.getByRole('button', { name: /connect an app/i }).click()
  await page.getByRole('button', { name: /scan or paste a link/i }).click()
  await page.getByLabel('Connection link').fill(URI)
  await page.getByRole('button', { name: /continue/i }).click()
  await page.getByRole('button', { name: /connect as default/i }).click()
  // The success screen shortcuts straight into the Connected apps list.
  await page.getByRole('button', { name: /manage connected apps/i }).click()
  await expect(page.getByRole('heading', { name: 'Connected apps' })).toBeVisible()
})
