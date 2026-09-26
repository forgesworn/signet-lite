import { test, expect } from '@playwright/test'
import { importIdentity } from './helpers'

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

test('bunker-link: import → Connect an app → Create a link → bunker:// URI is shown', async ({ page }) => {
  await importIdentity(page, 'default', ABANDON)
  await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()

  await page.getByRole('button', { name: /connect an app/i }).click()
  await expect(page.getByRole('heading', { name: 'Connect an app' })).toBeVisible()

  await page.getByRole('button', { name: /create a link for an app/i }).click()
  await page.getByRole('button', { name: /^create link$/i }).click()

  const uri = page.getByTestId('bunker-uri')
  await expect(uri).toBeVisible()
  const text = await uri.textContent()
  expect(text?.trim()).toMatch(/^bunker:\/\//)
})
