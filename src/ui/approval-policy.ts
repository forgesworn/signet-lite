import type { ApprovalRequest } from '../engine/signer.js'
import { appPolicies, type AppPolicies, type StoredApp } from '../app/db.js'
import { ZAP_REQUEST_KIND } from '../engine/zap.js'
import { loginChallenge } from '../engine/login-challenge.js'
import type { EventApprovalDetails } from '../engine/signer.js'

/** The outcome of checking an app's policy for a request. */
export type Decision = 'allow' | 'ask' | 'decline'

/** Map a NIP-46 method to its policy category, or null for benign/ungated methods. */
export function categoryOf(method: string): keyof AppPolicies | null {
  if (method === 'sign_event') return 'sign'
  if (method === 'nip44_encrypt' || method === 'nip44_decrypt' || method === 'nip04_decrypt') return 'dm'
  return null
}

/** Like categoryOf, but a sign_event for a kind-0 profile write maps to 'profile'. */
export function categoryForRequest(method: string, kind?: number): keyof AppPolicies | null {
  if (method === 'sign_event' && kind === 0) return 'profile'
  return categoryOf(method)
}

/** Decide whether a request auto-allows, needs a prompt, or is declined outright. */
export function resolveApproval(
  app: StoredApp | undefined,
  method: string,
  kind?: number,
  details?: EventApprovalDetails,
): Decision {
  // A login challenge (kind 22242 with a code to compare) always asks: the person has to check
  // the code against the login page, so no "always allow" may sign it silently.
  if (method === 'sign_event' && loginChallenge(details)) return 'ask'
  const category = categoryForRequest(method, kind)
  if (!category) return 'allow' // benign method — never gated
  const policies = appPolicies(app ?? {})
  if (category === 'profile') {
    return policies.profile === 'always' ? 'allow' : policies.profile === 'ask' ? 'ask' : 'decline'
  }
  if (!app) return 'ask'
  // A per-kind override wins over the blanket `sign` policy — granting one kind under a strict
  // default, or withholding one kind under a trusting default. Only for sign_event (kind ≠ 0;
  // kind 0 routes to `profile` above).
  if (category === 'sign' && kind !== undefined) {
    const override = app.kindPolicies?.[String(kind)]
    if (override) return override === 'always' ? 'allow' : 'ask'
    // A zap request (NIP-57 kind 9734) moves money, so a blanket "always allow signing" must NOT
    // silently auto-sign it — it always prompts unless the user explicitly granted this kind (the
    // "always allow zaps" choice, which sets the per-kind override handled just above).
    if (kind === ZAP_REQUEST_KIND) return 'ask'
  }
  return policies[category] === 'always' ? 'allow' : 'ask'
}

/** Build a StoredApp from an inbound approval request (used when persisting a first-seen app). */
export function appRecordFromRequest(req: ApprovalRequest, policies: AppPolicies): StoredApp {
  return {
    clientPubkey: req.clientPubkey,
    identityName: req.identityName,
    appName: `App ${req.clientPubkey.slice(0, 8)}`,
    policies,
    connectedAt: Math.floor(Date.now() / 1000),
  }
}
