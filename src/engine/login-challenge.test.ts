import { describe, it, expect } from 'vitest'
import { loginChallenge } from './login-challenge.js'

const login = (tags: string[][], kind = 22242) => ({ kind, createdAt: 0, tags, content: 'Log in to node' })

describe('loginChallenge', () => {
  it('reads the code and the site host from a kind-22242 login', () => {
    expect(loginChallenge(login([['challenge', 'ab'], ['relay', 'https://demo.example.org'], ['code', '5021']])))
      .toEqual({ code: '5021', site: 'demo.example.org' })
  })

  it('keeps a non-default port and tolerates a missing or odd relay tag', () => {
    expect(loginChallenge(login([['relay', 'http://node.local:8080'], ['code', '0044']]))?.site).toBe('node.local:8080')
    expect(loginChallenge(login([['code', '1234']]))).toEqual({ code: '1234', site: undefined })
    expect(loginChallenge(login([['relay', 'not a url'], ['code', '1234']]))?.site).toBeUndefined()
  })

  it('shows an internationalised host as punycode, so look-alike letters stand out', () => {
    expect(loginChallenge(login([['relay', 'https://exаmple.org'], ['code', '1234']]))?.site).toBe('xn--exmple-4nf.org')
  })

  it('is not plain NIP-42 relay auth, another kind, or a malformed code', () => {
    expect(loginChallenge(login([['relay', 'wss://relay.example'], ['challenge', 'x']]))).toBeNull()
    expect(loginChallenge(login([['code', '1234']], 1))).toBeNull()
    expect(loginChallenge(login([['code', '12a4']]))).toBeNull()
    expect(loginChallenge(login([['code', '12']]))).toBeNull()
    expect(loginChallenge(undefined)).toBeNull()
  })
})
