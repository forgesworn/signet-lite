import type { ProfileMetadata } from '../../app/db.js'

/** The kind-0 fields Lite's editor manages. Any OTHER keys in an existing profile (banner,
 *  display_name, custom fields) are preserved untouched through an edit — see buildKind0Content. */
const FIELDS = ['name', 'about', 'picture', 'website', 'nip05', 'lud16'] as const

/** Build the JSON content for a kind-0 event. Non-empty managed fields are written; empty ones are
 *  removed; any unmanaged keys from `base` (a previously-fetched profile) are carried through so
 *  republishing never drops fields Lite doesn't show. */
export function buildKind0Content(metadata: ProfileMetadata, base: Record<string, unknown> = {}): string {
  const out: Record<string, unknown> = { ...base }
  for (const f of FIELDS) {
    const v = metadata[f]?.trim()
    if (v) out[f] = v
    else delete out[f]
  }
  return JSON.stringify(out)
}

/** Parse a kind-0 event's JSON content. Returns the managed fields for the editor plus the full raw
 *  object, so a later buildKind0Content can preserve unmanaged keys. */
export function parseKind0Content(content: string): { metadata: ProfileMetadata; raw: Record<string, unknown> } {
  try {
    const obj: unknown = JSON.parse(content)
    if (typeof obj !== 'object' || obj === null) return { metadata: {}, raw: {} }
    const raw = obj as Record<string, unknown>
    const metadata: ProfileMetadata = {}
    for (const f of FIELDS) {
      if (typeof raw[f] === 'string') metadata[f] = raw[f] as string
    }
    const display = raw.display_name ?? raw.displayName
    if (typeof display === 'string') metadata.display_name = display
    return { metadata, raw }
  } catch {
    return { metadata: {}, raw: {} }
  }
}
