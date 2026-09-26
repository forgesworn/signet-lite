import { describe, it, expect } from 'vitest'
import { createRateLimiter } from './rate-limit.js'

describe('createRateLimiter', () => {
  it('is under budget until `max` records fall inside the window', () => {
    const rl = createRateLimiter({ max: 3, windowMs: 1000 })
    expect(rl.overBudget('app', 0)).toBe(false)
    rl.record('app', 0)
    rl.record('app', 1)
    expect(rl.overBudget('app', 2)).toBe(false) // 2 in window
    rl.record('app', 3)
    expect(rl.overBudget('app', 4)).toBe(true)  // 3 in window → at the cap
  })

  it('frees budget as records age out of the window', () => {
    const rl = createRateLimiter({ max: 2, windowMs: 1000 })
    rl.record('app', 100)
    rl.record('app', 200)
    expect(rl.overBudget('app', 300)).toBe(true)
    // At now=1201 the 100 and 200 records (cutoff 201) have aged out.
    expect(rl.overBudget('app', 1201)).toBe(false)
  })

  it('tracks each app independently', () => {
    const rl = createRateLimiter({ max: 1, windowMs: 1000 })
    rl.record('a', 0)
    expect(rl.overBudget('a', 1)).toBe(true)
    expect(rl.overBudget('b', 1)).toBe(false)
  })

  it('reset clears one app, and reset() clears all apps', () => {
    const rl = createRateLimiter({ max: 1, windowMs: 1000 })
    rl.record('a', 0)
    rl.record('b', 0)
    rl.reset('a')
    expect(rl.overBudget('a', 1)).toBe(false)
    expect(rl.overBudget('b', 1)).toBe(true)
    rl.reset()
    expect(rl.overBudget('b', 1)).toBe(false)
  })

  it('defaults to a generous 30-per-minute budget', () => {
    const rl = createRateLimiter()
    for (let i = 0; i < 29; i++) rl.record('app', i)
    expect(rl.overBudget('app', 29)).toBe(false) // 29 in the last minute
    rl.record('app', 29)
    expect(rl.overBudget('app', 30)).toBe(true)  // 30 → at the cap
  })
})
