import { test, expect } from '@playwright/test'
import { importIdentity, enterPin } from './helpers'

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const OTHER = 'legal winner thank year wave sausage worth useful legal winner thank yellow'

// H1: "Can't unlock? Restore" is a full reset of the device, gated behind an explicit warning.
test('restore from the unlock screen warns, then replaces the whole signet', async ({ page }) => {
  await importIdentity(page, 'oldname', ABANDON)
  await expect(page.getByText('Your identities')).toBeVisible()

  // Lock, then take the escape hatch.
  await page.reload()
  await page.getByRole('button', { name: /restore from your recovery phrase/i }).click()

  // The warning is explicit and gated.
  await expect(page.getByText(/erase everything on this device/i)).toBeVisible()
  const go = page.getByRole('button', { name: /erase and restore/i })
  await expect(go).toBeDisabled()
  await page.getByRole('checkbox', { name: /i understand/i }).check()
  await go.click()

  await page.getByLabel('Identity name').fill('fresh')
  await page.getByLabel('Recovery phrase').fill(OTHER)
  await page.getByRole('button', { name: /continue/i }).click()
  const pinInstead = page.getByText('Use a PIN instead')
  if (await pinInstead.isVisible().catch(() => false)) await pinInstead.click()
  await enterPin(page, '654321')

  // Only the restored identity remains.
  await expect(page.getByText('Your identities')).toBeVisible()
  await expect(page.getByTestId('identity-npub')).toHaveCount(1)
  await expect(page.getByText('oldname')).toHaveCount(0)
})

test('backing out of a restore from the unlock screen erases nothing', async ({ page }) => {
  await importIdentity(page, 'default', ABANDON)
  await expect(page.getByText('Your identities')).toBeVisible()
  await page.reload()

  await page.getByRole('button', { name: /restore from your recovery phrase/i }).click()
  await page.getByRole('button', { name: /cancel/i }).click()

  // Still the same signet: the original PIN unlocks it.
  await enterPin(page, '123456')
  await expect(page.getByText('Your identities')).toBeVisible()
  await expect(page.getByTestId('identity-npub')).toHaveCount(1)
})
