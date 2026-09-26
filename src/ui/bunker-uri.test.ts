import { describe, it, expect } from 'vitest'
import { buildBunkerUri } from './bunker-uri.js'

describe('buildBunkerUri', () => {
  it('builds a bunker:// with pubkey, encoded relays, and secret', () => {
    const uri = buildBunkerUri({ pubkeyHex: 'abcd', relays: ['wss://a.relay', 'wss://b.relay'], secret: 's3cret' })
    expect(uri).toBe('bunker://abcd?relay=wss%3A%2F%2Fa.relay&relay=wss%3A%2F%2Fb.relay&secret=s3cret')
  })
})
