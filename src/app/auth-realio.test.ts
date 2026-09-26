import { describe, it, expect, afterEach, vi } from 'vitest'
import { realIO } from './auth.js'

// L4: a cancelled Face ID prompt or an RP-ID mismatch rejects navigator.credentials.create.
// realIO.create must turn that into "no credential" (null) so callers show a message instead of
// leaking an unhandled rejection.
describe('realIO.create', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  function stubCreate(name: string) {
    vi.stubGlobal('window', { location: { hostname: 'preview.example' } })
    vi.stubGlobal('navigator', { credentials: { create: vi.fn(async () => { throw new DOMException('failed', name) }) } })
  }

  it('returns null when the user cancels (NotAllowedError)', async () => {
    stubCreate('NotAllowedError')
    await expect(realIO.create()).resolves.toBeNull()
  })

  it('returns null on a SecurityError (RP ID mismatch)', async () => {
    stubCreate('SecurityError')
    await expect(realIO.create()).resolves.toBeNull()
  })
})
