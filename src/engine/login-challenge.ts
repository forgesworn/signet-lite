import type { EventApprovalDetails } from './signer.js'

/** Kind 22242: NIP-42 relay auth, also used for logging in to a site with a signer. */
export const LOGIN_CHALLENGE_KIND = 22242

/** A login challenge a person must compare: the code the login page shows, and the site's host. */
export interface LoginChallenge {
  code: string
  site?: string
}

/**
 * A kind-22242 event carrying a `code` tag is a login a person started on another screen (the
 * login page shows the same digits). Plain NIP-42 relay auth has no code tag and is not this.
 * Returns the code and the host from the `relay` tag, or null when the event isn't one.
 */
export function loginChallenge(details: EventApprovalDetails | undefined): LoginChallenge | null {
  if (!details || details.kind !== LOGIN_CHALLENGE_KIND) return null
  const code = details.tags.find(t => t[0] === 'code')?.[1]
  if (!code || !/^\d{4,8}$/.test(code)) return null
  const relay = details.tags.find(t => t[0] === 'relay')?.[1]
  return { code, site: hostOf(relay) }
}

function hostOf(origin: string | undefined): string | undefined {
  if (!origin) return undefined
  try {
    const host = new URL(origin).host
    return host || undefined
  } catch {
    return undefined
  }
}
