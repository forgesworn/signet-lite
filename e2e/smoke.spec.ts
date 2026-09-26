import { test, expect } from '@playwright/test'
import { importIdentity } from './helpers'

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

test('boots to the welcome screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Create a new identity')).toBeVisible()
})

test('import → set PIN → lands on home with the identity', async ({ page }) => {
  await importIdentity(page, 'default', ABANDON)
  await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()
  await expect(page.getByTestId('identity-npub')).toBeVisible()
})
