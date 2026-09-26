import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

function pngSize(path: string) {
  const b = readFileSync(new URL(path, new URL('../', import.meta.url)))
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

describe('PWA icon assets', () => {
  it.each([
    ['public/icons/icon-192.png', 192],
    ['public/icons/icon-512.png', 512],
    ['public/icons/icon-512-maskable.png', 512],
    ['public/apple-touch-icon.png', 180],
  ])('%s is %ipx square', (p, n) => {
    const { w, h } = pngSize(p)
    expect([w, h]).toEqual([n, n])
  })
})
