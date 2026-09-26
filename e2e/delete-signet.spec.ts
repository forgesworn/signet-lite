import { test, expect } from '@playwright/test'
import { importIdentity } from './helpers'

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

test('danger zone: delete signet wipes the device and returns to setup', async ({ page }) => {
  await importIdentity(page, 'default', ABANDON)

  // Home → Settings → Danger zone → Delete signet
  await page.getByRole('button', { name: /settings/i }).click()
  await page.getByRole('button', { name: /delete signet/i }).click()

  // Confirmation screen: the delete button is gated until the recovery-phrase box is ticked.
  const del = page.getByRole('button', { name: /yes, delete everything/i })
  await expect(del).toBeVisible()
  await expect(del).toBeDisabled()
  await page.getByRole('checkbox', { name: /recovery phrase/i }).check()
  await expect(del).toBeEnabled()
  await del.click()

  // Lands back on the welcome/setup screen.
  await expect(page.getByText('Create a new identity')).toBeVisible()

  // The wipe is persistent: a fresh load still shows welcome (no master), not the unlock screen.
  await page.reload()
  await expect(page.getByText('Create a new identity')).toBeVisible()
})

test('danger zone: cancel keeps the signet intact', async ({ page }) => {
  await importIdentity(page, 'default', ABANDON)

  await page.getByRole('button', { name: /settings/i }).click()
  await page.getByRole('button', { name: /delete signet/i }).click()
  await page.getByRole('button', { name: /cancel/i }).click()

  // Back on Settings, nothing deleted.
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  // Reloading still finds the master → unlock screen, proving the identity survived.
  await page.reload()
  await expect(page.getByText(/unlock/i).first()).toBeVisible()
})
