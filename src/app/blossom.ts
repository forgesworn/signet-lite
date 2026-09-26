import type { Event as NostrEvent } from 'nostr-tools'

/** A template for the Signer to sign (matches Signer.signEventAs's parameter). */
export interface EventTemplate { kind: number; created_at?: number; tags?: string[][]; content: string }

/** lowercase-hex SHA-256 of the given bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

/** Build the BUD-01/02 upload authorization event template (kind 24242) binding the upload to a
 *  specific blob hash. The signer turns this into a signed event for the Authorization header. */
export function buildUploadAuth(sha256: string, now: number): EventTemplate {
  return {
    kind: 24242,
    created_at: now,
    tags: [
      ['t', 'upload'],
      ['x', sha256],
      ['expiration', String(now + 600)],
    ],
    content: 'Upload avatar',
  }
}

/** UTF-8-safe base64 of a (small) string — used for the `Authorization: Nostr <base64>` header. */
function base64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

function isAllowedHttpUrl(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname))
}

/** Normalise and validate a Blossom server base URL. Production servers must use HTTPS; loopback
 *  HTTP is allowed for local development and e2e tests. */
export function normaliseBlossomServer(server: string): string {
  const trimmed = server.trim()
  if (!trimmed) throw new Error('Image server URL is required')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Invalid image server URL')
  }
  if (!isAllowedHttpUrl(url) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid image server URL')
  }
  return trimSlash(url.toString())
}

function normaliseHostedUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Image upload returned no URL')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Image upload returned an invalid URL')
  }
  if (!isAllowedHttpUrl(url) || url.username || url.password) {
    throw new Error('Image upload returned an unsafe URL')
  }
  return url.toString()
}

/** Upload a blob to a Blossom server (BUD-02): hash it, sign a kind-24242 auth event, PUT the bytes
 *  with the auth header, and return the hosted URL. Integration glue — the auth builder + hashing
 *  are unit-tested; this fetch flow is covered by a mocked-fetch test. */
export async function uploadBlob(
  server: string,
  blob: Blob,
  sign: (template: EventTemplate) => NostrEvent,
  now: number = Math.floor(Date.now() / 1000),
): Promise<{ url: string; sha256: string }> {
  const baseUrl = normaliseBlossomServer(server)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const hash = await sha256Hex(bytes)
  const auth = sign(buildUploadAuth(hash, now))
  const res = await fetch(`${baseUrl}/upload`, {
    method: 'PUT',
    headers: {
      Authorization: `Nostr ${base64(JSON.stringify(auth))}`,
      'Content-Type': blob.type || 'application/octet-stream',
    },
    body: blob,
  })
  if (!res.ok) throw new Error(`Image upload failed (${res.status})`)
  const descriptor = await res.json() as { url?: string; sha256?: string }
  const hostedUrl = normaliseHostedUrl(descriptor.url)
  if (descriptor.sha256 !== undefined && descriptor.sha256 !== hash) throw new Error('Image upload returned a mismatched hash')
  return { url: hostedUrl, sha256: descriptor.sha256 ?? hash }
}
