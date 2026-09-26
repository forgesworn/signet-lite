import { finalizeEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import { deriveIdentity, type ResolvedIdentity } from './derive.js'
import { identityFromNsec, deriveChildFromNsec } from './nsec.js'
import {
  parseNostrConnectURI,
  parseNIP46Request,
  buildNIP46Response,
  nip44Encrypt,
  nip44EncryptSync,
  nip44Decrypt,
  nip04Decrypt,
  isFreshNIP46Event,
} from './nip46.js'
import { parseZapRequest, type ZapRequestDetails } from './zap.js'

/** Constant-time equality for two strings of the bunker secret's fixed hex length. Guards against a
 *  timing side-channel that would otherwise let an attacker recover the secret byte-by-byte from
 *  response-time differences on a naive `===`/`includes` compare. A length mismatch is public
 *  information (the secret's length is fixed and known), so short-circuiting on it leaks nothing. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Methods that access private key material and therefore require user approval. */
const METHODS_REQUIRING_APPROVAL = new Set(['sign_event', 'nip44_encrypt', 'nip44_decrypt', 'nip04_decrypt'])
const BUNKER_SECRET_TTL_MS = 5 * 60 * 1000

type Identity = ResolvedIdentity
type BunkerSecret = { secret: string; expiresAt: number }
/** An approval prompt still awaiting the user. `settle` denies it on the spot (lock/destroy) and
 *  returns the signed denial, built while the key is still live — or null if it cannot be. */
type PendingApproval = { settle: () => NostrEvent | null }

/** Optional hooks for {@link Signer.handleRequestEvent}. */
export interface HandleRequestHooks {
  /** Called once a request is known to be authentic and authorised (so unauthenticated relay spam
   *  never reaches it), BEFORE any approval prompt, signing or state change. Resolve false if the
   *  request was already claimed (e.g. by another tab) — it is then dropped, never double-handled. */
  claim?: () => Promise<boolean>
}

export interface EventApprovalDetails {
  kind: number
  createdAt: number
  tags: string[][]
  content: string
  /** Present only for a kind-9734 zap request — lets the prompt show the amount and recipient. */
  zap?: ZapRequestDetails
}

export interface ApprovalRequest {
  identityName: string
  clientPubkey: string
  method: string
  eventPreview?: string
  eventDetails?: EventApprovalDetails
  peerPubkey?: string
  plaintextPreview?: string
}

/** A handled-request notification for the activity log. Protocol-level facts only — the engine
 *  never reports decrypted content, plaintext, or DM counterparties. Transport/no-op methods
 *  (connect, ping, switch_relays) are not reported. */
export interface ActivityEvent {
  identityName: string
  clientPubkey: string
  method: string
  kind?: number          // sign_event only
  outcome: 'signed' | 'denied' | 'error'
  /** Resolved without prompting the user (an always-policy auto-approval). */
  auto: boolean
  /** The app's auto-approval budget was exceeded, so this request was forced to a prompt. */
  rateLimited: boolean
  /** A denial reached because the user never answered the prompt in time, rather than an explicit
   *  refusal — lets the activity log distinguish "Timed out" from "Declined". */
  timedOut?: boolean
  /** Present only when outcome is 'error': a short, fixed reason string. Protocol-level only —
   *  never carries plaintext, content, or client-supplied free text. */
  errorCode?: string
}

/** What the approve hook may return. A bare boolean is still accepted (legacy/tests); the richer
 *  form lets the App report how the decision was reached, for the activity log. */
export type ApprovalDecision = { ok: boolean; auto?: boolean; rateLimited?: boolean; timedOut?: boolean }

/** Methods the activity log ignores: connect is surfaced via onConnect, ping/switch_relays are
 *  keep-alive / no-op transport noise. */
const ACTIVITY_SKIP = new Set(['connect', 'ping', 'switch_relays'])

export class Signer {
  private identities   = new Map<string, Identity>()        // name → identity
  private byPubkey     = new Map<string, Identity>()        // pubkeyHex → identity
  private approved     = new Map<string, Set<string>>()     // identity pubkeyHex → approved client pubkeys
  private bunkerSecrets = new Map<string, BunkerSecret>()   // identity pubkeyHex → active bunker secret
  private pendingApprovals = new Set<PendingApproval>()

  constructor(
    identities: ResolvedIdentity[] = [],
    private opts: {
      approve?: (req: ApprovalRequest) => Promise<boolean | ApprovalDecision>
      onConnect?: (identityName: string, clientPubkey: string) => void | Promise<void>
      onActivity?: (entry: ActivityEvent) => void
      derive?: (name: string) => ResolvedIdentity
    } = {},
  ) {
    for (const id of identities) this.register(id)
  }

  /** Register a resolved identity in the lookup maps. */
  private register(id: Identity): void {
    this.identities.set(id.name, id)
    this.byPubkey.set(id.pubkeyHex, id)
    if (!this.approved.has(id.pubkeyHex)) this.approved.set(id.pubkeyHex, new Set())
  }

  addIdentity(name: string): { name: string; npub: string; pubkeyHex: string } {
    if (!this.opts.derive) throw new Error('this signer cannot derive new identities')
    // A duplicate name would silently replace the existing identity in the lookup maps — on an
    // nsec install, re-using the root's name swaps the root key for a derived child.
    if (this.identities.has(name)) throw new Error(`an identity named "${name}" already exists`)
    const id = this.opts.derive(name)
    this.register(id)
    return { name: id.name, npub: id.npub, pubkeyHex: id.pubkeyHex }
  }

  listIdentities(): { name: string; npub: string; pubkeyHex: string }[] {
    return [...this.identities.values()].map(id => ({ name: id.name, npub: id.npub, pubkeyHex: id.pubkeyHex }))
  }

  /** Remove a derived identity from this signer (the key stays re-derivable from the seed + name). */
  removeIdentity(name: string): void {
    const id = this.identities.get(name)
    if (!id) return
    id.privkeyHex = ''
    this.identities.delete(name)
    this.byPubkey.delete(id.pubkeyHex)
    this.approved.delete(id.pubkeyHex)
    this.bunkerSecrets.delete(id.pubkeyHex)
  }

  /** Drop all live key material and derivation closures held by this signer. */
  destroy(): void {
    // Settle any prompt still open BEFORE the keys are zeroed, so its continuation never tries to
    // encrypt/sign with an empty key (which threw, as an unhandled rejection).
    this.settlePendingApprovals()
    for (const id of this.identities.values()) id.privkeyHex = ''
    this.identities.clear()
    this.byPubkey.clear()
    this.approved.clear()
    this.bunkerSecrets.clear()
    this.opts = {}
  }

  /** Deny every approval still awaiting the user, synchronously. Returns the signed denial
   *  responses (built now, while the keys are live) for the caller to publish; each pending
   *  handleRequestEvent then resolves to null, so nothing is answered twice. */
  settlePendingApprovals(): NostrEvent[] {
    const out: NostrEvent[] = []
    for (const p of [...this.pendingApprovals]) {
      this.pendingApprovals.delete(p)
      try {
        const ev = p.settle()
        if (ev) out.push(ev)
      } catch {
        // A denial that cannot be built is dropped; the client times out.
      }
    }
    return out
  }

  /** Revoke a client app — remove it from every identity's approved set so its future requests are rejected. */
  revoke(clientPubkey: string): void {
    for (const set of this.approved.values()) set.delete(clientPubkey)
  }

  /** Revoke a client app only for one identity. */
  revokeForIdentity(name: string, clientPubkey: string): void {
    const id = this.identities.get(name)
    if (id) this.approved.get(id.pubkeyHex)!.delete(clientPubkey)
  }

  /** Start a bunker session for an identity: mint a fresh secret a client must present to connect. */
  enableBunker(name: string): { pubkeyHex: string; secret: string } {
    const id = this.identities.get(name)
    if (!id) throw new Error(`unknown identity: ${name}`)
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const secret = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    this.bunkerSecrets.set(id.pubkeyHex, { secret, expiresAt: Date.now() + BUNKER_SECRET_TTL_MS })
    return { pubkeyHex: id.pubkeyHex, secret }
  }

  /** Disable any active bunker secret for an identity. */
  disableBunker(name: string): void {
    const id = this.identities.get(name)
    if (id) this.bunkerSecrets.delete(id.pubkeyHex)
  }

  /** Authorise a client for an identity (e.g. restoring a persisted connection on unlock). */
  authorize(name: string, clientPubkey: string): void {
    const id = this.identities.get(name)
    if (id) this.approved.get(id.pubkeyHex)!.add(clientPubkey)
  }

  /** Sign one of the user's OWN events with an identity key — used for in-app actions like
   *  publishing a kind-0 profile or a Blossom (kind-24242) upload authorization. NOT gated by the
   *  approve hook: this is the user acting directly in Lite, not a remote app requesting a signature. */
  signEventAs(identityName: string, template: { kind: number; created_at?: number; tags?: string[][]; content: string }): NostrEvent {
    const id = this.identities.get(identityName)
    if (!id) throw new Error(`unknown identity: ${identityName}`)
    const privBytes = hexToBytes(id.privkeyHex)
    try {
      return finalizeEvent(
        {
          kind: template.kind,
          created_at: template.created_at ?? Math.floor(Date.now() / 1000),
          tags: template.tags ?? [],
          content: template.content,
        },
        privBytes,
      )
    } finally {
      privBytes.fill(0)
    }
  }

  async pair(uri: string, identityName: string): Promise<{ clientPubkey: string; connectResponse: NostrEvent }> {
    const req = parseNostrConnectURI(uri)
    if (!req) throw new Error('invalid nostrconnect URI')
    const id = this.identities.get(identityName)
    if (!id) throw new Error(`unknown identity: ${identityName}`)
    this.approved.get(id.pubkeyHex)!.add(req.clientPubkey)
    // Echo the secret so the client can verify it is talking to the right signer
    const ackPlaintext = buildNIP46Response('connect', req.secret)
    const connectResponse = await this.wrap(id, req.clientPubkey, ackPlaintext)
    return { clientPubkey: req.clientPubkey, connectResponse }
  }

  async handleRequestEvent(event: NostrEvent, hooks: HandleRequestHooks = {}): Promise<NostrEvent | null> {
    if (!isFreshNIP46Event(event.created_at)) return null

    // Identify which of our identities the request is addressed to (via 'p' tag)
    const idPub = event.tags.find(t => t[0] === 'p')?.[1]
    const id = idPub ? this.byPubkey.get(idPub) : undefined
    if (!id) return null

    // Decrypt the NIP-44 request content — return null if undecryptable.
    let plaintext: string
    try {
      plaintext = await nip44Decrypt(id.privkeyHex, event.pubkey, event.content)
    } catch {
      return null
    }
    const req = parseNIP46Request(plaintext)
    if (!req) return null

    // The event kind, for a sign_event request — recorded in the activity log and shown in
    // the approval prompt. undefined for every other method.
    const signKind = req.method === 'sign_event' && req.params[0] ? parseEventTemplate(req.params[0])?.kind : undefined

    // Authorisation: an approved client proceeds; an UNAPPROVED client may only be
    // authorised by a `connect` carrying this identity's active bunker secret.
    if (!this.approved.get(id.pubkeyHex)!.has(event.pubkey)) {
      const bunker = this.bunkerSecrets.get(id.pubkeyHex)
      if (bunker && bunker.expiresAt <= Date.now()) this.bunkerSecrets.delete(id.pubkeyHex)
      if (req.method === 'connect' && bunker && bunker.expiresAt > Date.now() && req.params.some(p => timingSafeEqualHex(p, bunker.secret))) {
        if (hooks.claim) {
          if (!(await hooks.claim())) return null
          // Re-check after the await: the secret may have been consumed or the identity removed.
          if (this.bunkerSecrets.get(id.pubkeyHex) !== bunker || this.byPubkey.get(id.pubkeyHex) !== id) return null
        }
        this.bunkerSecrets.delete(id.pubkeyHex)
        this.approved.get(id.pubkeyHex)!.add(event.pubkey)
        try {
          await this.opts.onConnect?.(id.name, event.pubkey)
        } catch {
          this.approved.get(id.pubkeyHex)!.delete(event.pubkey)
          return null
        }
        // A bunker:// connect is answered with "ack". Per NIP-46 the secret is echoed back only
        // in the client-initiated nostrconnect:// flow (see `pair()`), where the client MUST
        // validate it against the secret it generated; in the bunker:// flow the secret is used
        // solely to authorise this connect (single-use, above) and the response is a plain "ack".
        // Echoing the secret here breaks strict clients such as rust-nostr's NostrConnect (the
        // Cambium signer proxy), whose connect() requires exactly "ack" and rejects anything else;
        // lenient clients (nostr-tools) ignore the connect result either way.
        return this.wrap(id, event.pubkey, buildNIP46Response(req.id, 'ack'))
      }
      return null
    }

    // Claim the request (persisted replay store) before prompting or signing, so a second tab or a
    // crash-and-replay cannot handle it twice. If handling fails after this, the request stays
    // claimed and is dropped — the safe direction for a signer.
    if (hooks.claim) {
      if (!(await hooks.claim())) return null
      if (this.byPubkey.get(id.pubkeyHex) !== id || !this.approved.get(id.pubkeyHex)?.has(event.pubkey)) return null
    }

    // Optional per-request approval gate — only for methods that use key material sensitively.
    // Benign methods (get_public_key, ping, connect, switch_relays) proceed without prompting.
    // How the approval was reached — surfaced in the activity log. Benign/ungated methods are
    // never auto-approved in this sense, so both stay false for them.
    let auto = false
    let rateLimited = false
    if (METHODS_REQUIRING_APPROVAL.has(req.method)) {
      if (!this.opts.approve) {
        this.emitActivity(id, event.pubkey, req.method, signKind, 'denied', auto, rateLimited)
        return this.wrap(id, event.pubkey, buildNIP46Response(req.id, undefined, 'denied'))
      }
      const approval = buildApprovalRequest(id.name, event.pubkey, req.method, req.params)
      // Race the prompt against a lock: destroy()/settlePendingApprovals() denies it synchronously,
      // with the key still live, and this call then resolves to null.
      let settledByLock = false
      let wake!: () => void
      const locked = new Promise<null>(resolve => { wake = () => resolve(null) })
      const pending: PendingApproval = {
        settle: () => {
          settledByLock = true
          wake()
          if (!id.privkeyHex) return null
          this.emitActivity(id, event.pubkey, req.method, signKind, 'denied', false, false)
          return this.wrapSync(id, event.pubkey, buildNIP46Response(req.id, undefined, 'denied'))
        },
      }
      this.pendingApprovals.add(pending)
      let raced: boolean | ApprovalDecision | null
      try {
        raced = await Promise.race([this.opts.approve(approval), locked])
      } finally {
        this.pendingApprovals.delete(pending)
      }
      // Settled by a lock (its denial already handed out), or the identity was destroyed/removed
      // while the prompt was open: never touch the (zeroed) key.
      if (settledByLock || raced === null) return null
      if (this.byPubkey.get(id.pubkeyHex) !== id || !id.privkeyHex) return null
      const decision = raced
      const ok = typeof decision === 'boolean' ? decision : decision.ok
      auto = typeof decision === 'boolean' ? false : (decision.auto ?? false)
      rateLimited = typeof decision === 'boolean' ? false : (decision.rateLimited ?? false)
      const timedOut = typeof decision === 'boolean' ? false : (decision.timedOut ?? false)
      if (!ok) {
        this.emitActivity(id, event.pubkey, req.method, signKind, 'denied', auto, rateLimited, timedOut)
        return this.wrap(id, event.pubkey, buildNIP46Response(req.id, undefined, 'denied'))
      }
    }

    let result: string | null | undefined
    let error: string | undefined

    try {
      switch (req.method) {
        case 'get_public_key':
          result = id.pubkeyHex
          break

        case 'sign_event': {
          if (!req.params[0]) {
            error = 'missing event template'
            break
          }
          const tmpl = parseEventTemplate(req.params[0])
          if (!tmpl) {
            error = 'invalid event template'
            break
          }
          const privBytes = hexToBytes(id.privkeyHex)
          let signed: NostrEvent
          try {
            signed = finalizeEvent(
              { kind: tmpl.kind, created_at: tmpl.created_at, tags: tmpl.tags, content: tmpl.content },
              privBytes,
            )
          } finally {
            privBytes.fill(0)
          }
          result = JSON.stringify(signed)
          break
        }

        case 'nip44_encrypt':
          if (req.params.length < 2) {
            error = 'missing params'
            break
          }
          result = await nip44Encrypt(id.privkeyHex, req.params[0], req.params[1])
          break

        case 'nip44_decrypt':
          if (req.params.length < 2) {
            error = 'missing params'
            break
          }
          result = await nip44Decrypt(id.privkeyHex, req.params[0], req.params[1])
          break

        // Legacy NIP-04 read support: decrypt only. Lite offers no nip04_encrypt, so it can
        // read historical kind-4 DMs but never creates new (deprecated) NIP-04 ciphertext.
        case 'nip04_decrypt':
          if (req.params.length < 2) {
            error = 'missing params'
            break
          }
          result = await nip04Decrypt(id.privkeyHex, req.params[0], req.params[1])
          break

        case 'connect':
          result = 'ack'
          break

        case 'ping':
          result = 'pong'
          break

        case 'switch_relays':
          // Lite's relays are user-managed; no-op, but return JSON null to match
          // My Signet's response shape (signet-login tolerates either).
          result = null
          break

        default:
          // Fixed string only — the actual method is already recorded in the `method` field, and
          // echoing unbounded client input into errorCode would defeat that field's bounds.
          error = 'unsupported method'
      }
    } catch {
      error = 'request failed'
    }

    this.emitActivity(id, event.pubkey, req.method, signKind, error ? 'error' : 'signed', auto, rateLimited, false, error)
    const respPlaintext = buildNIP46Response(req.id, error ? undefined : result, error)
    return this.wrap(id, event.pubkey, respPlaintext)
  }

  /** Notify the activity log of a handled request, skipping transport/no-op methods. */
  private emitActivity(id: Identity, clientPubkey: string, method: string, kind: number | undefined, outcome: ActivityEvent['outcome'], auto: boolean, rateLimited: boolean, timedOut = false, errorCode?: string): void {
    if (!this.opts.onActivity || ACTIVITY_SKIP.has(method)) return
    const entry: ActivityEvent = { identityName: id.name, clientPubkey, method, kind, outcome, auto, rateLimited }
    if (timedOut) entry.timedOut = true
    if (errorCode) entry.errorCode = errorCode
    this.opts.onActivity(entry)
  }

  /** Encrypt plaintext to the client and sign the response event with the identity key. */
  private async wrap(id: Identity, clientPubkey: string, plaintext: string): Promise<NostrEvent> {
    return this.wrapSync(id, clientPubkey, plaintext)
  }

  private wrapSync(id: Identity, clientPubkey: string, plaintext: string): NostrEvent {
    if (!id.privkeyHex) throw new Error('identity key is no longer available')
    const content = nip44EncryptSync(id.privkeyHex, clientPubkey, plaintext)
    const privBytes = hexToBytes(id.privkeyHex)
    try {
      return finalizeEvent(
        { kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', clientPubkey]], content },
        privBytes,
      )
    } finally {
      privBytes.fill(0)
    }
  }
}

function parseEventTemplate(raw: string): { kind: number; created_at: number; tags: string[][]; content: string } | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const obj = parsed as Record<string, unknown>
    if (!Number.isInteger(obj.kind) || !Number.isInteger(obj.created_at)) return null
    if (typeof obj.content !== 'string') return null
    if (!Array.isArray(obj.tags)) return null
    if (!obj.tags.every(tag => Array.isArray(tag) && tag.every(item => typeof item === 'string'))) return null
    return { kind: obj.kind as number, created_at: obj.created_at as number, tags: obj.tags as string[][], content: obj.content }
  } catch {
    return null
  }
}

/** Build a signer whose identities are derived from a BIP-39 mnemonic. */
export function signerFromMnemonic(
  mnemonic: string,
  names: string[] = [],
  opts: { approve?: (req: ApprovalRequest) => Promise<boolean | ApprovalDecision>; onConnect?: (identityName: string, clientPubkey: string) => void | Promise<void>; onActivity?: (entry: ActivityEvent) => void } = {},
): Signer {
  const identities = names.map(n => deriveIdentity(mnemonic, n))
  return new Signer(identities, { ...opts, derive: (name) => deriveIdentity(mnemonic, name) })
}

/** Build a signer rooted at an imported nsec: the 'root' record is the raw key,
 *  every other record (and every future addIdentity) is a fromNsec child. */
export function signerFromNsec(
  nsec: string,
  stored: { name: string; derivation?: 'root' | 'derived' }[],
  opts: { approve?: (req: ApprovalRequest) => Promise<boolean | ApprovalDecision>; onConnect?: (identityName: string, clientPubkey: string) => void | Promise<void>; onActivity?: (entry: ActivityEvent) => void } = {},
): Signer {
  const identities = stored.map(s =>
    s.derivation === 'root' ? identityFromNsec(nsec, s.name) : deriveChildFromNsec(nsec, s.name),
  )
  return new Signer(identities, { ...opts, derive: (name) => deriveChildFromNsec(nsec, name) })
}

function buildApprovalRequest(identityName: string, clientPubkey: string, method: string, params: string[]): ApprovalRequest {
  const req: ApprovalRequest = { identityName, clientPubkey, method }
  if (method === 'sign_event' && params[0]) {
    const tmpl = parseEventTemplate(params[0])
    if (tmpl) {
      req.eventPreview = tmpl.content
      req.eventDetails = {
        kind: tmpl.kind,
        createdAt: tmpl.created_at,
        tags: tmpl.tags,
        content: tmpl.content,
        zap: parseZapRequest(tmpl.kind, tmpl.tags) ?? undefined,
      }
    }
  }
  if (method === 'nip44_encrypt' || method === 'nip44_decrypt' || method === 'nip04_decrypt') {
    req.peerPubkey = params[0]
    if (method === 'nip44_encrypt') req.plaintextPreview = params[1]
  }
  return req
}
