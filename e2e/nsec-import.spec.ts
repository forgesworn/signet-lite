import { test, expect } from '@playwright/test'
import { enterPin } from './helpers'

// A real nsec (nsec-tree-cli vector). Its own public identity is NPUB.
const NSEC = 'nsec1gc8hf0g9c33lu0qwj3l7dfstpwmrcskljy88zu4dnmv07sq0el8qftpamx'
const NPUB = 'npub10vssllkca9ecvn7dk9pvklls2fjfzyy3mqt3rp683fzepsg7skusaalt7w'

test('restore from an nsec: default identity is the pasted npub, and you can add more', async ({ page }) => {
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
  await expect(page.getByTestId('identity-npub')).toHaveText(NPUB)

  // Derive a second identity from the same nsec.
  await page.getByRole('button', { name: /add identity/i }).click()
  await page.getByLabel('New identity name').fill('work')
  await page.getByRole('button', { name: /^add$/i }).click()
  await expect(page.getByTestId('identity-npub')).toHaveCount(2)
})
