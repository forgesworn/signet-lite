/**
 * Identity profile (kind 0) + Blossom avatar E2E test.
 *
 * Drives the whole profile flow through the real UI: point the signer at a local
 * in-process relay, open an identity's profile editor, fill the fields, attach an
 * avatar, and Save & publish. Asserts that:
 *   - the avatar bytes are PUT to the Blossom server with a NIP-98-style
 *     `Authorization: Nostr <base64>` header (BUD-02 kind-24242 auth), and
 *   - the kind-0 metadata event lands on the relay, signed by the identity, with
 *     the typed fields and the uploaded picture URL, and
 *   - the saved avatar shows on the Home thumbnail.
 *
 * Blossom is stubbed at the network layer (page.route) so no bytes leave the box;
 * the relay is the local in-process one so no test profile reaches a real relay.
 */
import { test, expect } from '@playwright/test'
import { startRelay } from './local-relay.js'
import { importIdentity } from './helpers.js'

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// deriveIdentity(ABANDON, 'default').pubkeyHex — the same vector as the bunker/nostrconnect specs.
const EXPECTED_PUBKEY = '669452f36131312d1932b63cc0695b3861a15105dfeb13781ed1af5b8aff6dc5'

// The URL the stubbed Blossom server hands back for the uploaded blob.
const HOSTED_PICTURE = 'https://cdn.example.test/avatar-deadbeef.png'

// A 1×1 transparent PNG — the avatar bytes we upload.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const PNG_1x1_SHA256 = 'a4dd28db6e6d3fc0d43cdbef1e8ef161b353ce67d27e81d400f796bc77045ae6'

test('profile: upload avatar to Blossom + publish kind-0 to the relay', async ({ page }) => {
  test.setTimeout(60_000)
  const relay = await startRelay()
  console.error('[test] local relay started at', relay.url)

  // ── Stub the Blossom upload (BUD-02 PUT /upload) ──────────────────────────
  const uploads: { method: string; auth: string | undefined; contentType: string | undefined }[] = []
  await page.route('**/upload', async route => {
    const req = route.request()
    uploads.push({
      method: req.method(),
      auth: req.headers()['authorization'],
      contentType: req.headers()['content-type'],
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: HOSTED_PICTURE, sha256: PNG_1x1_SHA256 }),
    })
  })

  try {
    // ── Import the identity ───────────────────────────────────────────────
    await importIdentity(page, 'default', ABANDON)
    await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()

    // ── Point the signer at the local relay only ──────────────────────────
    // Settings → Relays: add the local relay, then remove the default real relays
    // so publishing (and the profile fetch) go to the in-process relay alone.
    await page.getByRole('button', { name: /settings/i }).click()
    await page.getByRole('button', { name: /^Relays/ }).click()
    await page.getByLabel('Add relay').fill(relay.url)
    await page.getByRole('button', { name: /^add$/i }).click()
    await expect(page.getByText(relay.url)).toBeVisible()

    const removeBtns = page.getByRole('button', { name: /^remove$/i })
    // Remove the leading (default) rows until only the appended local relay remains;
    // the last Remove button is disabled (a signer needs ≥1 relay), so stop at 1.
    let count = await removeBtns.count()
    while (count > 1) {
      await removeBtns.first().click()
      await expect(removeBtns).toHaveCount(count - 1)
      count--
    }
    await expect(page.getByText(relay.url)).toBeVisible()

    const prefsAfterRelayEdit = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('signet-lite')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => resolve(req.result)
      })
      const prefs = await new Promise<{ relays?: string[] } | undefined>((resolve, reject) => {
        const req = db.transaction('prefs').objectStore('prefs').get('prefs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => resolve(req.result)
      })
      db.close()
      return prefs
    })
    expect(prefsAfterRelayEdit?.relays).toEqual([relay.url])

    // Point the Blossom image server at the page's own origin. The app's CSP
    // (connect-src 'self' ws: wss:) blocks cross-origin uploads before page.route
    // can intercept them, so the stubbed /upload must be same-origin.
    const origin = new URL(page.url()).origin
    const blossomField = page.getByLabel('Image server')
    await blossomField.fill(origin)
    await blossomField.blur() // saved on blur

    await page.getByRole('button', { name: 'Back', exact: true }).click()
    // Settings → Home.
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()
    // SignerRelay re-subscribes asynchronously after the relay list changes.
    await page.waitForTimeout(1500)

    // ── Open the profile editor and fill it in ────────────────────────────
    await page.getByRole('button', { name: /edit profile/i }).click()
    await expect(page.getByRole('heading', { name: 'Edit profile' })).toBeVisible()
    // The editor fetches kind-0 first; wait for the form to settle.
    const nameField = page.getByLabel('Name', { exact: true })
    await expect(nameField).toBeVisible()
    await nameField.fill('Acme Magazine')
    await page.getByLabel('Bio').fill('Published straight from Signet Lite.')

    // Attach the avatar to the hidden file input.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: PNG_1x1,
    })
    // The chosen image previews in the editor.
    await expect(page.getByRole('img', { name: 'Profile picture' })).toBeVisible()

    // ── Save & publish ────────────────────────────────────────────────────
    // Arm the relay listener before the publish so we never miss the event.
    const kind0P = relay.waitForEvent(e => e.kind === 0 && e.pubkey === EXPECTED_PUBKEY, 45_000)
    await page.getByRole('button', { name: /save & publish/i }).click()

    // Saving returns to Home.
    await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()

    // ── Assert: the avatar was uploaded to Blossom with kind-24242 auth ────
    expect(uploads).toHaveLength(1)
    expect(uploads[0].method).toBe('PUT')
    expect(uploads[0].auth).toMatch(/^Nostr /)
    expect(uploads[0].contentType).toBe('image/png')

    // ── Assert: the kind-0 reached the relay with the right content ────────
    const kind0 = await kind0P
    const content = JSON.parse(kind0.content) as Record<string, string>
    expect(content.name).toBe('Acme Magazine')
    expect(content.about).toBe('Published straight from Signet Lite.')
    expect(content.picture).toBe(HOSTED_PICTURE)

    // ── Assert: the saved avatar shows on the Home thumbnail ───────────────
    await expect(page.locator('.card img').first()).toBeVisible()

  } finally {
    await relay.close()
    console.error('[test] relay closed')
  }
})
