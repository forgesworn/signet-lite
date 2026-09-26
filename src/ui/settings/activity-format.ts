// Pure presentation helpers for the activity log — kept out of the component so they unit-test
// without rendering.

import type { ActivityOutcome } from '../../app/db.js'

/** A few common kinds get a friendly verb; anything else is shown with its kind number. */
const KIND_LABELS: Record<number, string> = {
  0: 'Updated your profile',
  1: 'Signed a note',
  3: 'Updated your contacts',
  6: 'Signed a repost',
  7: 'Signed a reaction',
}

/** A human description of what an app asked the signer to do. */
export function describeActivity(method: string, kind?: number): string {
  switch (method) {
    case 'sign_event':
      if (kind !== undefined && KIND_LABELS[kind]) return KIND_LABELS[kind]
      return kind === undefined ? 'Signed an event' : `Signed an event (kind ${kind})`
    case 'nip44_encrypt':
      return 'Encrypted a message'
    case 'nip44_decrypt':
      return 'Read a message'
    case 'get_public_key':
      return 'Read your public key'
    default:
      return method
  }
}

/** Short past-tense word for the outcome, shown as a status chip. For a denial: `timedOut` means
 *  the prompt was never answered ("Timed out"); otherwise `auto` distinguishes a request Signet
 *  declined on its own — a standing rule, e.g. profile writes are blocked by default — which reads
 *  as "Blocked", from one you declined at a prompt, which reads as "Declined". */
export function outcomeLabel(outcome: ActivityOutcome, auto = false, timedOut = false): string {
  switch (outcome) {
    case 'signed': return 'Signed'
    case 'denied': return timedOut ? 'Timed out' : auto ? 'Blocked' : 'Declined'
    case 'error': return 'Failed'
  }
}

/** The name to show for an activity row. The app's CURRENT name wins, so renaming a connected
 *  app flows through to its whole history; the name snapshotted at log time only fills in for an
 *  app that's since been forgotten (no live record); a pubkey stub is the last resort. */
export function activityAppName(liveName: string | undefined, snapshot: string | undefined, clientPubkey: string): string {
  return liveName ?? snapshot ?? `App ${clientPubkey.slice(0, 8)}`
}

/** A friendly, non-technical reason for a failed request, from the engine's fixed errorCode.
 *  Unknown codes fall through to the raw string so a new code still shows something. */
export function errorDetail(errorCode: string | undefined): string | undefined {
  if (!errorCode) return undefined
  switch (errorCode) {
    case 'invalid event template': return 'Invalid request from the app'
    case 'missing event template': return 'The app sent nothing to sign'
    case 'missing params': return 'The app left out required details'
    case 'unsupported method': return 'The app asked for something unsupported'
    case 'request failed': return 'Something went wrong'
    default: return errorCode
  }
}

/** Compact relative time ("just now", "5m ago", "3h ago", "2d ago"), falling back to a date.
 *  Both arguments are epoch seconds; `now` is injected so this is deterministic under test. */
export function formatRelativeTime(tsSeconds: number, nowSeconds: number): string {
  const delta = Math.max(0, nowSeconds - tsSeconds)
  if (delta < 45) return 'just now'
  const mins = Math.floor(delta / 60)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hours = Math.floor(delta / 3600)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(delta / 86400)
  if (days < 7) return `${days}d ago`
  return new Date(tsSeconds * 1000).toLocaleDateString()
}
