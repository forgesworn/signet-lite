import { useState, useEffect } from 'react'
import type { ApprovalRequest } from '../../engine/signer.js'
import { Hint } from '../components/Hint'
import { sanitizeDisplayName } from '../../engine/text-sanitize.js'

/** Caps for display text. Generous: this is for legibility, not truncating what is signed. */
const NAME_MAX = 100
const TEXT_MAX = 4000

/** Strip control and bidi/invisible characters (RLO, zero-width…) that could visually disguise
 *  what is being approved, using the shared sanitiser. Multi-line text is cleaned line by line so
 *  its line breaks survive (the sanitiser treats newline as a control character). */
function cleanName(s: string): string { return sanitizeDisplayName(s, NAME_MAX) }
function cleanText(s: string): string {
  return s.split('\n').map(line => sanitizeDisplayName(line, TEXT_MAX)).join('\n').slice(0, TEXT_MAX)
}

/** Plain-English description of what a request will do, plus the category phrase used in the
 *  per-category "always allow" choice. */
function describe(method: string): { action: string; category: string } {
  switch (method) {
    case 'sign_event': return { action: 'Post or sign something as you', category: 'sign posts & actions' }
    case 'nip44_encrypt': return { action: 'Send a private message as you', category: 'read & write your messages' }
    case 'nip44_decrypt':
    case 'nip04_decrypt': return { action: 'Read one of your private messages', category: 'read & write your messages' }
    default: return { action: method, category: 'do this' }
  }
}

/** Group satoshi amounts for legibility, e.g. 21000 → "21,000". */
function formatSats(sats: number): string {
  return sats.toLocaleString('en-GB')
}

/** Abbreviate a hex pubkey for display, e.g. "1a2b3c4d…7788". */
function shortId(hex: string): string {
  return hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : hex
}

export function ApproveSign({ req, appName: rawAppName, explain, rateLimited = false, onDecide }: {
  req: ApprovalRequest
  appName: string
  explain: boolean
  /** This request was auto-approved by policy but forced to a prompt because the app exceeded
   *  its recent auto-sign budget — worth flagging so the user notices a possible runaway app. */
  rateLimited?: boolean
  onDecide: (ok: boolean, alwaysAllow: boolean) => void
}) {
  const [alwaysAllow, setAlwaysAllow] = useState(false)
  // One decision per prompt (H5): after the first tap both buttons disable, so a double tap can't
  // send a second decision that would land on whichever request moves up next.
  const [decided, setDecided] = useState(false)
  const appName = cleanName(rawAppName)
  const identityName = cleanName(req.identityName)

  function decide(ok: boolean, always: boolean) {
    if (decided) return
    setDecided(true)
    onDecide(ok, always)
  }

  // The FIFO approval queue can advance to a different request while this component instance
  // is reused (no per-request key upstream), which would otherwise let a stale tick grant an
  // auto-sign policy the user never consented to for the NEW request. Reset on every request change.
  const reqSignature = `${req.method}|${req.identityName}|${req.clientPubkey}|${JSON.stringify(req.eventDetails)}`
  useEffect(() => {
    setAlwaysAllow(false)
    setDecided(false)
  }, [reqSignature])

  const { action: methodAction, category } = describe(cleanName(req.method))
  const zap = req.eventDetails?.zap
  const action = zap ? 'Send a Lightning zap as you' : methodAction

  // "Always allow" is granular for signing: it grants only THIS kind (kind 0 is a profile
  // write, which keeps its category-wide choice). DMs stay category-wide too. A zap (kind 9734)
  // gets friendlier wording, but is still a per-kind grant under the hood.
  const signKind = req.method === 'sign_event' ? req.eventDetails?.kind : undefined
  const perKind = signKind !== undefined && signKind !== 0
  const alwaysLabel = zap
    ? `Always allow ${appName} to send zaps as you`
    : perKind
      ? `Always allow ${appName} to sign kind-${signKind} events`
      : `Always allow ${appName} to ${category}`

  return (
    <main className="page fade-in">
      <h2 className="section-title">Approve request</h2>

      <Hint show={explain}>
        {appName} wants to use your key. If you just asked it to do this, tap Approve. If you weren't
        expecting it, tap Deny — nothing is signed unless you approve.
      </Hint>

      {rateLimited && (
        <div className="card" role="alert" style={{ marginBottom: 16, borderColor: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 8%, transparent)' }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--danger)' }}>
            ⚠ {appName} has signed a lot just now
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            It's normally trusted, but it's gone over its recent limit, so we're asking. Approve only if you expected this; otherwise deny and consider revoking it.
          </p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ fontWeight: 700, fontSize: 15, margin: '0 0 4px' }}>{appName}</p>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 6px' }}>
          Signing as <strong>{identityName}</strong>
        </p>
        <p style={{ fontSize: 14, margin: 0 }}>Wants to: <strong>{action}</strong></p>
        {explain && (
          <p style={{ color: 'var(--text-muted)', fontSize: 11.5, margin: '4px 0 0', fontFamily: 'monospace' }}>{cleanName(req.method)}</p>
        )}
      </div>

      {zap && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent, #f7931a)', background: 'color-mix(in srgb, var(--accent, #f7931a) 8%, transparent)' }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 4px', fontWeight: 600 }}>Lightning zap</p>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            ⚡ {zap.amountSat !== undefined ? `${formatSats(zap.amountSat)} sats` : 'Amount set when you pay'}
          </p>
          {zap.recipientPubkey && (
            <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
              {/* L6: sanitise before truncating — an app-supplied 'p' tag, not protocol-validated
                  hex, could otherwise carry bidi/zero-width characters into the shortened id. */}
              To <strong>{shortId(cleanName(zap.recipientPubkey))}</strong>
            </p>
          )}
        </div>
      )}

      {req.eventPreview && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 4px', fontWeight: 600 }}>{zap ? 'Zap message' : 'Note preview'}</p>
          <p style={{ margin: 0, fontSize: 14 }}>{cleanText(req.eventPreview)}</p>
        </div>
      )}

      {req.eventDetails && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 6px', fontWeight: 600 }}>Event details</p>
          <p style={{ margin: '0 0 3px', fontSize: 13 }}>Kind: <strong>{req.eventDetails.kind}</strong></p>
          <p style={{ margin: '0 0 3px', fontSize: 13 }}>Tags: <strong>{req.eventDetails.tags.length}</strong></p>
          <p style={{ margin: '0 0 6px', fontSize: 13 }}>Created: <strong>{new Date(req.eventDetails.createdAt * 1000).toLocaleString()}</strong></p>
          {/* Show EVERY tag (scrollable), never a truncated subset — tags are where mass deletes,
              follow-list changes, and zap amounts would otherwise hide past the first few. */}
          {req.eventDetails.tags.length > 0 && (
            <div style={{ maxHeight: 132, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {req.eventDetails.tags.map((t, i) => (
                <p key={i} style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {t.map(cleanText).join(' · ')}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {(req.peerPubkey || req.plaintextPreview) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 6px', fontWeight: 600 }}>Message details</p>
          {req.peerPubkey && <p style={{ margin: '0 0 3px', fontSize: 12, wordBreak: 'break-all' }}>Peer: <strong>{cleanName(req.peerPubkey)}</strong></p>}
          {req.plaintextPreview && <p style={{ margin: 0, fontSize: 13 }}>{cleanText(req.plaintextPreview)}</p>}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="checkbox"
          id="always-allow"
          checked={alwaysAllow}
          onChange={e => setAlwaysAllow(e.target.checked)}
          style={{ width: 18, height: 18, flexShrink: 0 }}
        />
        <label htmlFor="always-allow" style={{ fontSize: 14, cursor: 'pointer' }}>
          {alwaysLabel}
        </label>
      </div>

      <button
        className="btn btn-primary"
        style={{ width: '100%', marginBottom: 8 }}
        disabled={decided}
        onClick={() => decide(true, alwaysAllow)}
      >
        Approve
      </button>
      <button
        className="btn btn-ghost"
        style={{ width: '100%' }}
        disabled={decided}
        onClick={() => decide(false, false)}
      >
        Deny
      </button>
    </main>
  )
}
