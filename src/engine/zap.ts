// NIP-57 zap-request (kind 9734) recognition for the signing approval prompt. A zap request is
// the user-signed event handed to an LNURL service, which pays the invoice and publishes the
// kind-9735 receipt. The signer never moves funds — but signing the request is the only point at
// which the user can see what they are authorising, so we surface the amount and recipient.
//
// Pure and dependency-free, so signet-app can copy it verbatim (the two repos share no package).

export const ZAP_REQUEST_KIND = 9734

export interface ZapRequestDetails {
  /** Amount in millisatoshis when the request fixes one. The NIP-57 `amount` tag is optional —
   *  when absent the payer chooses the amount later. */
  amountMsat?: number
  /** Whole satoshis (floor of `amountMsat` / 1000), when an amount is fixed. */
  amountSat?: number
  /** Recipient pubkey (hex) from the first `p` tag. */
  recipientPubkey?: string
  /** The note (`e` tag) or addressable coordinate (`a` tag) being zapped, when present. */
  zappedEventId?: string
  zappedAddress?: string
}

/** Extract zap-request details from a parsed event, or `null` when `kind` is not a zap request.
 *  Tolerant by design: a missing or malformed field is left undefined rather than throwing, so a
 *  hostile template can never break the approval prompt. */
export function parseZapRequest(kind: number, tags: string[][]): ZapRequestDetails | null {
  if (kind !== ZAP_REQUEST_KIND) return null

  const value = (name: string): string | undefined =>
    tags.find(t => t[0] === name && typeof t[1] === 'string')?.[1]

  const details: ZapRequestDetails = {
    recipientPubkey: value('p'),
    zappedEventId: value('e'),
    zappedAddress: value('a'),
  }

  const amount = value('amount')
  if (amount && /^\d+$/.test(amount)) {
    const msat = Number(amount)
    if (Number.isSafeInteger(msat) && msat > 0) {
      details.amountMsat = msat
      details.amountSat = Math.floor(msat / 1000)
    }
  }

  return details
}
