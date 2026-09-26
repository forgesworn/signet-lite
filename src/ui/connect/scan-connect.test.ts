import { describe, it, expect } from 'vitest'
import { parseScannedConnect } from './scan-connect.js'

const VALID = 'nostrconnect://02fb29738aa718806afe21f7940c125be5892a216fef0fc9aec1569014fe7c0c?relay=wss%3A%2F%2Frelay.damus.io&secret=abc'

describe('parseScannedConnect', () => {
  it('returns a valid nostrconnect URI from scanned text', () => {
    expect(parseScannedConnect(VALID)).toBe(VALID)
  })

  it('trims surrounding whitespace/newlines a QR payload may carry', () => {
    expect(parseScannedConnect(`  ${VALID}\n`)).toBe(VALID)
  })

  it('rejects QR text that is not a connectable nostrconnect URI', () => {
    expect(parseScannedConnect('https://example.com')).toBeNull()
    expect(parseScannedConnect('bunker://02fb29738aa718806afe21f7940c125be5892a216fef0fc9aec1569014fe7c0c?relay=wss://r&secret=s')).toBeNull()
    expect(parseScannedConnect('just some text')).toBeNull()
    expect(parseScannedConnect('')).toBeNull()
  })
})
