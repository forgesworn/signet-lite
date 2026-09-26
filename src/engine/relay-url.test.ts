import { describe, it, expect } from 'vitest'
import { isValidRelayUrl } from './relay-url.js'

describe('isValidRelayUrl', () => {
  it.each([
    'wss://relay.damus.io',
    'wss://relay.damus.io/',
    'WSS://Relay.Example.com:444/path',
    'ws://localhost:7777',
    'ws://127.0.0.1',
    'ws://127.0.0.1:4869/',
  ])('accepts %s', (u) => {
    expect(isValidRelayUrl(u)).toBe(true)
  })

  it.each([
    'wss://', // no host: new URL throws (audit H2)
    'wss://relay damus.io', // space: new URL throws
    'wss://%zz', // bad percent-escape: new URL throws
    'wss://a b',
    'ws://relay.damus.io', // plaintext off loopback
    'ws://127.0.0.1:80@evil.com', // userinfo trick: the real host is evil.com
    'ws://localhost@evil.com',
    'https://relay.damus.io',
    'relay.damus.io',
    '',
  ])('rejects %s', (u) => {
    expect(isValidRelayUrl(u)).toBe(false)
  })

  it('never accepts a URL that new URL() rejects', () => {
    for (const u of ['wss://', 'wss://%zz', 'wss://a b', 'wss://[bad']) {
      expect(() => new URL(u)).toThrow()
      expect(isValidRelayUrl(u)).toBe(false)
    }
  })
})
