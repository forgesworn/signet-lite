// Lifted from forgesworn/signet-app src/lib/text-sanitize.ts (audited).
/**
 * Shared display-name / display-text sanitiser.
 *
 * Strips control characters and bidi / invisible Unicode (the same character
 * class used everywhere attacker-controlled strings reach a display surface —
 * URL auth params, NIP-46 metadata, contact QR names, kind-0 profile fields),
 * then trims, then caps at `maxLen`.
 *
 * Order matters: strip -> trim -> slice (trim BEFORE slice). This is the
 * dominant order across the codebase. Call sites that strip-then-slice-then-
 * trim (slice BEFORE trim) can differ by a few trailing chars and are NOT
 * migrated to this helper — see the O2 notes for the parity exceptions.
 *
 * Character class (matches url-auth.ts / contact-qr.ts):
 *   U+0000-001F C0 controls; U+007F-009F DEL + C1 controls;
 *   U+200B-200F zero-width + LRM/RLM; U+2028-202E separators + bidi
 *   embedding/override; U+2066-2069 bidi isolates.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_BIDI = /[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;

/** Strip control + bidi/invisible chars, then trim, then cap at maxLen. */
export function sanitizeDisplayName(raw: string, maxLen: number): string {
  return raw.replace(CONTROL_BIDI, '').trim().slice(0, maxLen);
}
