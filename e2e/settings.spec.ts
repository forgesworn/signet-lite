import { test, expect } from '@playwright/test'
import { importIdentity, enterPin } from './helpers'

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

test('settings: toggle dark theme', async ({ page }) => {
  await importIdentity(page, 'default', ABANDON)
  await page.getByRole('button', { name: /settings/i }).click()
  await page.getByRole('button', { name: /^dark$/i }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('settings: backup reveals the phrase after re-auth', async ({ page }) => {
  await importIdentity(page, 'default', ABANDON)
  await page.getByRole('button', { name: /settings/i }).click()
  await page.getByRole('button', { name: /backup phrase/i }).click()
  await enterPin(page, '123456') // re-auth
  await expect(page.getByText('abandon', { exact: false }).first()).toBeVisible()
})
