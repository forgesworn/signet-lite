import { type Page } from '@playwright/test'

/** Drive the import flow to home: name the identity, type the phrase, set a PIN. */
export async function importIdentity(page: Page, name: string, mnemonic: string, pin = '123456') {
  await page.goto('/')
  await page.getByText('I already have a backup').click()
  await page.getByLabel('Identity name').fill(name)
  await page.getByLabel('Recovery phrase').fill(mnemonic)
  await page.getByRole('button', { name: /continue/i }).click()
  // setup-unlock: choose PIN if a Face ID gate is shown; otherwise the pad is already up.
  const pinInstead = page.getByText('Use a PIN instead')
  if (await pinInstead.isVisible().catch(() => false)) await pinInstead.click()
  await enterPin(page, pin)
}

/** Click the PinPad digits in order. */
export async function enterPin(page: Page, pin: string) {
  for (const d of pin) await page.getByRole('button', { name: d, exact: true }).click()
}
