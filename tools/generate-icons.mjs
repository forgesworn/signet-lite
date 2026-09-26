import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const svg = readFileSync(new URL('public/favicon.svg', root), 'utf8')
// Maskable icons must fill the entire square — no transparent rounded
// corners showing through — so the maskable target swaps the icon's
// rounded-square `rx` for a full-bleed rect at the same ivory fill.
const maskableSvg = svg.replace(/rx="[\d.]+"/, 'rx="0"')
const targets = [
  { size: 192, out: 'public/icons/icon-192.png', svg },
  { size: 512, out: 'public/icons/icon-512.png', svg },
  { size: 512, out: 'public/icons/icon-512-maskable.png', svg: maskableSvg },
  { size: 180, out: 'public/apple-touch-icon.png', svg },
]
mkdirSync(new URL('public/icons/', root), { recursive: true })
const browser = await chromium.launch()
for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><html><body style="margin:0;padding:0">`
    + t.svg.replace('<svg', `<svg width="${t.size}" height="${t.size}"`) + `</body></html>`)
  writeFileSync(new URL(t.out, root), await page.screenshot())
  await page.close()
}
await browser.close()
console.error('icons generated')
