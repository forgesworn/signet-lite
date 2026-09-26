import { useState } from 'react'
import { Hint } from '../components/Hint'
import type { ActivityOutcome } from '../../app/db.js'
import { describeActivity, outcomeLabel, formatRelativeTime, errorDetail } from './activity-format.js'

export interface ActivityRow {
  id: number
  ts: number
  appName: string
  identityName: string
  method: string
  kind?: number
  outcome: ActivityOutcome
  /** Auto-approved without a prompt (always-policy). */
  auto: boolean
  /** Forced to a prompt because the app's auto-approval budget was exceeded. */
  rateLimited: boolean
  /** A denial that happened because the prompt was never answered in time. */
  timedOut?: boolean
  /** Present only on a failed request: a short, fixed reason code from the engine. */
  errorCode?: string
}

/** A small inline badge (e.g. "Auto", "Rate-limited"). */
function Badge({ text, tone }: { text: string; tone: 'muted' | 'warn' }) {
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 600, lineHeight: 1.6, padding: '0 6px', borderRadius: 5, marginLeft: 6,
      color: tone === 'warn' ? 'var(--on-accent)' : 'var(--text-secondary)',
      background: tone === 'warn' ? 'var(--danger)' : 'var(--bg-secondary)',
    }}>{text}</span>
  )
}

/** Colour for the outcome chip: signed reads as the accent, declined is muted, errors are danger. */
function outcomeColour(outcome: ActivityOutcome): string {
  if (outcome === 'error') return 'var(--danger)'
  if (outcome === 'denied') return 'var(--text-secondary)'
  return 'var(--accent)'
}

export function Activity({
  entries,
  nowSeconds,
  explain,
  scopeLabel,
  onClear,
  onBack,
}: {
  entries: ActivityRow[]
  nowSeconds: number
  explain: boolean
  /** When viewing one app's history, the app's name — shown in the subtitle. */
  scopeLabel?: string
  onClear: () => void
  onBack: () => void
}) {
  const [confirmClear, setConfirmClear] = useState(false)

  return (
    <main className="page fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button className="btn btn-ghost" aria-label="Back" style={{ width: 'auto', padding: '6px 10px', fontSize: 18 }} onClick={onBack}>←</button>
        <h1 className="section-title" style={{ margin: 0 }}>Activity</h1>
      </div>

      {scopeLabel && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>For {scopeLabel}</p>
      )}

      <Hint show={explain}>
        A record of what your connected apps have asked Signet to do. It's kept on this device
        only and never includes the contents of what was signed or read.
      </Hint>

      {entries.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '32px 16px' }}>
          <p style={{ fontSize: 15, marginBottom: 6 }}>No activity yet</p>
          <p style={{ fontSize: 13 }}>Signing and message requests will show up here.</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
            {entries.map((e, i) => (
              <div
                key={e.id}
                style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
                  padding: '12px 16px',
                  borderBottom: i < entries.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14.5, fontWeight: 500 }}>
                    {describeActivity(e.method, e.kind)}
                    {e.rateLimited && <Badge text="Rate-limited" tone="warn" />}
                    {e.auto && !e.rateLimited && e.outcome === 'signed' && <Badge text="Auto" tone="muted" />}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.appName} · {e.identityName}
                  </p>
                  {e.outcome === 'error' && errorDetail(e.errorCode) && (
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--danger)' }}>{errorDetail(e.errorCode)}</p>
                  )}
                  {e.outcome === 'denied' && e.timedOut && (
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>No response — declined automatically</p>
                  )}
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: outcomeColour(e.outcome) }}>{outcomeLabel(e.outcome, e.auto, e.timedOut)}</span>
                  <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>{formatRelativeTime(e.ts, nowSeconds)}</p>
                </div>
              </div>
            ))}
          </div>

          {confirmClear ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => { onClear(); setConfirmClear(false) }}>
                Clear history
              </button>
              <button className="btn btn-ghost" style={{ width: 'auto' }} onClick={() => setConfirmClear(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setConfirmClear(true)}>
              Clear history
            </button>
          )}
        </>
      )}
    </main>
  )
}
