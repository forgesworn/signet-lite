import { describe, it, expect } from 'vitest'
import { pickConfirmIndices, checkConfirm } from './confirm.js'

const WORDS = ['voyage','lemon','brisk','anchor','fabric','simple','gather','oxygen','ritual','velvet','shadow','custom']

describe('confirm-backup logic', () => {
  it('picks N distinct in-range indices', () => {
    const picks = pickConfirmIndices(12, 2, (() => { let i = 0; const seq = [0.1, 0.9]; return () => seq[i++ % seq.length] })())
    expect(picks).toHaveLength(2)
    expect(new Set(picks).size).toBe(2)
    picks.forEach(p => { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(12) })
  })
  it('checkConfirm is true only when every answer matches (case/space-insensitive)', () => {
    expect(checkConfirm(WORDS, [1, 10], ['  Lemon ', 'SHADOW'])).toBe(true)
    expect(checkConfirm(WORDS, [1, 10], ['lemon', 'velvet'])).toBe(false)
  })
})
