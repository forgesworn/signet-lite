// @vitest-environment jsdom
// Fast reconnect on foreground/online (M1): createSession wires visibilitychange/online
// listeners to SignerRelay.reconnectNow() for the life of the session, and tears them down on
// lock(). Kept in its own file (rather than session.test.ts) so the jsdom document/window are
// not polluted by other session.test.ts tests that create sessions without locking them.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSession } from './session.js'
import { deriveIdentity } from '../engine/derive.js'
import { SignerRelay, type RelayPool } from '../engine/relay.js'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

function fakePool(): RelayPool {
  return { subscribe(_relays, _pubkeys, _cb) { return { close() {} } }, publish() {}, close() {} }
}

afterEach(() => { vi.restoreAllMocks() })

describe('createSession: fast reconnect on foreground/online (M1)', () => {
  it('reconnects immediately when the document becomes visible', () => {
    deriveIdentity(M, 'magazine')
    const session = createSession({ mnemonic: M, identityNames: ['magazine'], relays: ['wss://r'], approve: async () => true, pool: fakePool() })
    const spy = vi.spyOn(SignerRelay.prototype, 'reconnectNow')

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(spy).toHaveBeenCalledTimes(1)
    session.lock()
  })

  it('reconnects immediately on a window "online" event', () => {
    const session = createSession({ mnemonic: M, identityNames: ['magazine'], relays: ['wss://r'], approve: async () => true, pool: fakePool() })
    const spy = vi.spyOn(SignerRelay.prototype, 'reconnectNow')

    window.dispatchEvent(new Event('online'))

    expect(spy).toHaveBeenCalledTimes(1)
    session.lock()
  })

  it('does not reconnect on a visibilitychange to hidden', () => {
    const session = createSession({ mnemonic: M, identityNames: ['magazine'], relays: ['wss://r'], approve: async () => true, pool: fakePool() })
    const spy = vi.spyOn(SignerRelay.prototype, 'reconnectNow')

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(spy).not.toHaveBeenCalled()
    session.lock()
  })

  it('removes the listeners on lock(), so nothing fires once the session is locked', () => {
    const session = createSession({ mnemonic: M, identityNames: ['magazine'], relays: ['wss://r'], approve: async () => true, pool: fakePool() })
    const spy = vi.spyOn(SignerRelay.prototype, 'reconnectNow')
    session.lock()

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))

    expect(spy).not.toHaveBeenCalled()
  })
})
