import { test, expect } from '@playwright/test'
import { importIdentity, enterPin } from './helpers'

// The same vectors pinned at the unit level in src/engine/derive.test.ts, captured
// from a real `nsec-tree-cli` run (2026-06-23). This proves the *UI* surfaces them.
const CLI_MNEMONIC = 'beauty clog outside grant mule afford beyond flat food deposit father join'
const CLI_PASSPHRASE_NPUB = 'npub10vssllkca9ecvn7dk9pvklls2fjfzyy3mqt3rp683fzepsg7skusaalt7w'

test('importing the CLI mnemonic as "passphrase" shows the CLI npub on screen', async ({ page }) => {
  await importIdentity(page, 'passphrase', CLI_MNEMONIC)
  await expect(page.getByRole('heading', { name: 'Your identities' })).toBeVisible()
  await expect(page.getByTestId('identity-npub')).toHaveText(CLI_PASSPHRASE_NPUB)
})

test('the npub survives a lock + PIN unlock round-trip', async ({ page }) => {
  await importIdentity(page, 'passphrase', CLI_MNEMONIC)
  await expect(page.getByTestId('identity-npub')).toHaveText(CLI_PASSPHRASE_NPUB)
  await page.getByRole('button', { name: /lock now/i }).click()
  await enterPin(page, '123456') // returning unlock screen
  await expect(page.getByTestId('identity-npub')).toHaveText(CLI_PASSPHRASE_NPUB)
})
