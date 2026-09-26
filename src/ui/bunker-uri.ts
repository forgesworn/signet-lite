/** Build a NIP-46 bunker:// connection string the user pastes into an app. */
export function buildBunkerUri(opts: { pubkeyHex: string; relays: string[]; secret: string }): string {
  const relayParams = opts.relays.map(r => `relay=${encodeURIComponent(r)}`).join('&')
  return `bunker://${opts.pubkeyHex}?${relayParams}&secret=${opts.secret}`
}
