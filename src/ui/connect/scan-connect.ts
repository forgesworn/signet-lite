import { parseNostrConnectURI } from '../../engine/nip46.js'

/** Extract a usable nostrconnect URI from decoded QR text, or null if it isn't a connectable one.
 *  A QR may carry trailing whitespace/newlines; we trim, then validate with the real parser so the
 *  scanner only stops on a code it can actually connect with (and ignores unrelated QRs). */
export function parseScannedConnect(text: string): string | null {
  const trimmed = text.trim()
  return parseNostrConnectURI(trimmed) ? trimmed : null
}
