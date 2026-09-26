import { describe, it, expect } from 'vitest'
import { decideInitialScreen } from './screen.js'

describe('decideInitialScreen', () => {
  it('routes to unlock when a master exists, welcome otherwise', () => {
    expect(decideInitialScreen(true)).toBe('unlock')
    expect(decideInitialScreen(false)).toBe('welcome')
  })
})
