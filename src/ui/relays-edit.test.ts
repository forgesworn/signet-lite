import { describe, it, expect } from 'vitest'
import { addRelay, removeRelay, sessionRelays } from './relays-edit.js'

describe('relays-edit', () => {
  it('adds a valid wss relay', () => {
    expect(addRelay(['wss://a'], 'wss://b')).toEqual({ relays: ['wss://a', 'wss://b'] })
  })
  it('rejects an invalid or duplicate relay', () => {
    expect(addRelay(['wss://a'], 'http://x').error).toBeTruthy()
    expect(addRelay(['wss://a'], 'wss://a').error).toBeTruthy()
  })
  it('removes a relay but never empties the list', () => {
    expect(removeRelay(['wss://a', 'wss://b'], 'wss://a')).toEqual(['wss://b'])
    expect(removeRelay(['wss://a'], 'wss://a')).toEqual(['wss://a']) // no-op on the last one
  })

  // M1: the signer listens on the user's relays plus every relay a paired nostrconnect app asked
  // for, so one pairing (or a relay edit) can't silently deafen another app.
  it('sessionRelays unions the user list with every stored app relay, user relays first, no dups', () => {
    const apps = [{ relays: ['wss://a.example', 'wss://mine.example'] }, {}, { relays: ['wss://b.example'] }]
    expect(sessionRelays(['wss://mine.example'], apps)).toEqual(['wss://mine.example', 'wss://a.example', 'wss://b.example'])
  })

  it('sessionRelays drops a malformed stored app relay instead of passing it to the pool', () => {
    expect(sessionRelays(['wss://mine.example'], [{ relays: ['wss://%zz', 'wss://', 'wss://ok.example'] }]))
      .toEqual(['wss://mine.example', 'wss://ok.example'])
  })
})
