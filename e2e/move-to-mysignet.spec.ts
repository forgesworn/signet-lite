import { test, expect } from '@playwright/test'
import { importIdentity, enterPin } from './helpers'

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
// A real nsec (nsec-tree-cli vector); this string must NEVER appear in the Move screen.
const NSEC = 'nsec1gc8hf0g9c33lu0qwj3l7dfstpwmrcskljy88zu4dnmv07sq0el8qftpamx'

test('move to my signet: a recovery-phrase identity reveals its 12 words after re-auth', async ({ page }) => {
  await importIdentity(page, 'default', ABANDON)
  await page.getByRole('button', { name: /settings/i }).click()
  await page.getByRole('button', { name: /move to my signet/i }).click()
  await enterPin(page, '123456') // re-auth

  // The 12 words and the identity name are shown so the user can restore in My Signet.
  await expect(page.getByLabel(/lite recovery phrase/i)).toHaveValue(ABANDON)
  await expect(page.getByLabel(/lite identity name/i)).toHaveValue('default')
  await expect(page.getByRole('button', { name: /copy restore details/i })).toBeVisible()
})

test('move to my signet: an nsec-imported identity is NEVER shown its private key', async ({ page }) => {
  // Restore from an nsec (the only path that could expose a raw key).
  await page.goto('/')
  await page.getByText('I already have a backup').click()
  await page.getByLabel('Identity name').fill('main')
  await page.getByRole('button', { name: /have an nsec instead/i }).click()
  await page.getByLabel('Your nsec').fill(NSEC)
  await page.getByRole('button', { name: /continue/i }).click()
  const pinInstead = page.getByText('Use a PIN instead')
  if (await pinInstead.isVisible().catch(() => false)) await pinInstead.click()
  await enterPin(page, '123456')
  await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()

  // Move to My Signet → re-auth → guidance only.
  await page.getByRole('button', { name: /settings/i }).click()
  await page.getByRole('button', { name: /move to my signet/i }).click()
  await enterPin(page, '123456')

  await expect(page.getByText(/never reveals it/i)).toBeVisible()
  // No key is rendered and there is no copy affordance for a private key.
  await expect(page.getByRole('button', { name: /copy nsec/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /copy restore details/i })).toHaveCount(0)
  await expect(page.getByText(NSEC, { exact: false })).toHaveCount(0)
  expect(await page.content()).not.toContain(NSEC)
})
