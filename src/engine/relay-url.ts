// Lifted from forgesworn/signet-app src/lib/relay-url.ts (audited).
/**
 * Relay-URL scheme validation — the single source of truth for the relay-URL
 * security invariant.
 *
 * Production relays MUST be `wss://` (TLS). Plaintext `ws://` is permitted only
 * for `localhost` / `127.0.0.1` (local development / loopback bunkers). This
 * mirrors the rule enforced at every relay boundary: relay-service setter,
 * relay-publish, nip46 connect parser, qr-router, presentation parser,
 * badge-fetch, and the Settings relay editor.
 *
 * Every module that needs this check imports from here — do not re-define a
 * local copy. Tightening or loosening this regex is a security-relevant change.
 */
export function isValidRelayUrl(url: string): boolean {
  if (!(/^wss:\/\//i.test(url) || /^ws:\/\/(localhost|127\.0\.0\.1)([:\/]|$)/i.test(url))) return false;
  // The scheme check alone lets through strings that `new URL` (and so the relay pool's
  // normalizeURL) throws on — `wss://`, `wss://a b`, `wss://%zz` — which then kill the
  // subscription synchronously. Require a real parse, a ws(s) scheme and a host.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!parsed.hostname) return false;
  if (parsed.protocol === 'wss:') return true;
  // Plaintext only to loopback — checked on the PARSED host, so userinfo tricks such as
  // `ws://127.0.0.1:80@evil.com` (whose real host is evil.com) are refused.
  return parsed.protocol === 'ws:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
}
