import { describe, it, expect } from 'vitest'
import { parseZapRequest, ZAP_REQUEST_KIND } from './zap.js'

describe('parseZapRequest', () => {
  it('returns null for a non-zap kind', () => {
    expect(parseZapRequest(1, [['amount', '21000']])).toBeNull()
  })

  it('extracts amount (msat → sat), recipient, and the zapped note', () => {
    const z = parseZapRequest(ZAP_REQUEST_KIND, [
      ['relays', 'wss://relay.example'],
      ['amount', '21000'],
      ['p', 'recipientpubkeyhex'],
      ['e', 'zappednoteid'],
    ])
    expect(z?.amountMsat).toBe(21000)
    expect(z?.amountSat).toBe(21)
    expect(z?.recipientPubkey).toBe('recipientpubkeyhex')
    expect(z?.zappedEventId).toBe('zappednoteid')
  })

  it('floors fractional-sat amounts (1500 msat → 1 sat)', () => {
    const z = parseZapRequest(ZAP_REQUEST_KIND, [['amount', '1500']])
    expect(z?.amountMsat).toBe(1500)
    expect(z?.amountSat).toBe(1)
  })

  it('leaves amount undefined when the request fixes none', () => {
    const z = parseZapRequest(ZAP_REQUEST_KIND, [['p', 'recipientpubkeyhex']])
    expect(z?.amountSat).toBeUndefined()
    expect(z?.recipientPubkey).toBe('recipientpubkeyhex')
  })

  it('ignores a malformed (non-numeric) amount rather than throwing', () => {
    const z = parseZapRequest(ZAP_REQUEST_KIND, [['amount', '21k'], ['p', 'pk']])
    expect(z?.amountMsat).toBeUndefined()
    expect(z?.recipientPubkey).toBe('pk')
  })

  it('extracts an addressable target from an `a` tag', () => {
    const z = parseZapRequest(ZAP_REQUEST_KIND, [['a', '30023:pubkey:slug']])
    expect(z?.zappedAddress).toBe('30023:pubkey:slug')
  })
})
