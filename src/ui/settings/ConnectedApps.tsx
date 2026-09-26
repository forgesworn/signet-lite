import { useState } from 'react'
import { Hint } from '../components/Hint'
import { PlusIcon } from '../components/icons.js'
import type { AppPolicies, ResolvedPolicies, ActionPolicy, ProfilePolicy } from '../../app/db.js'

/** The two signing categories, with human labels + a one-line explanation of what each covers. */
const CATEGORIES: { key: keyof AppPolicies; label: string; covers: string }[] = [
  { key: 'sign', label: 'Sign posts & actions', covers: 'Post notes, reactions and other events as you.' },
  { key: 'dm', label: 'Private messages', covers: 'Read and write your encrypted direct messages.' },
]

/** One plain line describing how this app is trusted, based on sign and dm. */
function trustLabel(policies: ResolvedPolicies): string {
  if (policies.sign === 'always' && policies.dm === 'always') return 'Trusted.  No prompts.'
  if (policies.sign === 'ask' && policies.dm === 'ask') return 'Asks before actions.'
  return 'Custom permissions.'
}

const PROFILE_OPTIONS: { value: ProfilePolicy; label: string }[] = [
  { value: 'decline', label: 'Decline' },
  { value: 'ask', label: 'Ask' },
  { value: 'always', label: 'Allow' },
]

export function ConnectedApps({
  apps,
  explain,
  onAddConnection,
  onRename,
  onSetPolicy,
  onResetKind,
  onRevoke,
  onCopyBunker,
  onViewActivity,
  onBack,
}: {
  apps: { clientPubkey: string; displayName: string; identityName: string; policies: ResolvedPolicies; kindPolicies: Record<string, ActionPolicy> }[]
  explain: boolean
  onAddConnection: () => void
  onRename: (identityName: string, clientPubkey: string, label: string) => void
  onSetPolicy: (identityName: string, clientPubkey: string, category: keyof AppPolicies, value: ActionPolicy | ProfilePolicy) => void
  onResetKind: (identityName: string, clientPubkey: string, kind: number) => void
  onRevoke: (identityName: string, clientPubkey: string) => void
  /** Mint a fresh bunker secret for this app's identity and return the bunker:// link to copy. */
  onCopyBunker: (identityName: string, clientPubkey: string) => string
  onViewActivity: (identityName: string, clientPubkey: string) => void
  onBack: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // The app whose bunker link was just copied, keyed identity+client, for the transient "Copied!".
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  // Same key scheme, for a failed copy on that app's card.
  const [copyErrorKey, setCopyErrorKey] = useState<string | null>(null)

  function startRename(pk: string, current: string) { setEditing(pk); setDraft(current) }
  function saveRename(identityName: string, pk: string) { onRename(identityName, pk, draft.trim()); setEditing(null); setDraft('') }

  // Build the link synchronously (keeps the clipboard write inside the click gesture for Safari),
  // copy it, and flash "Copied!" on that app for 2s.
  function copyBunker(identityName: string, pk: string) {
    const key = `${identityName}:${pk}`
    setCopyErrorKey(null)
    const uri = onCopyBunker(identityName, pk)
    navigator.clipboard.writeText(uri).then(() => {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    }).catch(() => {
      setCopyErrorKey(key)
    })
  }

  return (
    <main className="page fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button className="btn btn-ghost" aria-label="Back" style={{ width: 'auto', padding: '6px 10px', fontSize: 18 }} onClick={onBack}>←</button>
        <h1 className="section-title" style={{ margin: 0 }}>Connected apps</h1>
      </div>

      <button
        className="btn btn-primary"
        style={{ width: '100%', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        onClick={onAddConnection}
      >
        <PlusIcon size={18} /> Connect an app
      </button>

      <Hint show={explain}>
        These are the apps you've allowed to sign on your behalf. Give one a name so you remember which
        site it is, choose what it's allowed to do, and remove any you no longer use.
      </Hint>

      {apps.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '32px 16px' }}>
          <p style={{ fontSize: 15, marginBottom: 6 }}>No apps connected</p>
          <p style={{ fontSize: 13 }}>Apps you connect via NIP-46 will appear here.</p>
        </div>
      ) : (
        apps.map(app => (
          <div className="card" key={app.clientPubkey} style={{ marginBottom: 12 }}>
            {/* Name row — editable */}
            {editing === app.clientPubkey ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <input
                  className="input"
                  aria-label="App name"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveRename(app.identityName, app.clientPubkey) }}
                  style={{ flex: 1, boxSizing: 'border-box' }}
                  autoFocus
                />
                <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={() => saveRename(app.identityName, app.clientPubkey)}>Save</button>
                <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => setEditing(null)}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <p style={{ fontSize: 15, fontWeight: 600, margin: 0, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {app.displayName}
                </p>
                <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} aria-label={`Rename ${app.displayName}`} onClick={() => startRename(app.clientPubkey, app.displayName)}>Rename</button>
                <button className="btn btn-ghost btn-sm" style={{ width: 'auto', color: 'var(--danger)' }} onClick={() => onRevoke(app.identityName, app.clientPubkey)}>Revoke</button>
              </div>
            )}
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 4px' }}>Signs as {app.identityName}</p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>{trustLabel(app.policies)}</p>

            {/* Per-category signing policy */}
            {CATEGORIES.map(cat => (
              <div key={cat.key} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{cat.label}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['ask', 'always'] as ActionPolicy[]).map(value => {
                      const active = app.policies[cat.key] === value
                      return (
                        <button
                          key={value}
                          aria-label={`${cat.label}: ${value === 'ask' ? 'Ask every time' : 'Always allow'}`}
                          aria-pressed={active}
                          onClick={() => onSetPolicy(app.identityName, app.clientPubkey, cat.key, value)}
                          style={{
                            padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5,
                            fontWeight: active ? 700 : 400,
                            background: active ? 'var(--accent)' : 'var(--bg-secondary)',
                            color: active ? 'var(--on-accent)' : 'var(--text-primary)',
                          }}
                        >
                          {value === 'ask' ? 'Ask' : 'Always'}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {explain && (
                  <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '3px 0 0' }}>{cat.covers}</p>
                )}
              </div>
            ))}

            {Object.keys(app.kindPolicies).length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Per-kind exceptions</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {Object.entries(app.kindPolicies)
                    .sort((a, b) => Number(a[0]) - Number(b[0]))
                    .map(([kind, value]) => (
                      <span key={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 6px 3px 9px', borderRadius: 7, background: 'var(--bg-secondary)' }}>
                        kind {kind}: {value === 'always' ? 'Always' : 'Ask'}
                        <button
                          aria-label={`Reset kind ${kind} for ${app.displayName}`}
                          onClick={() => onResetKind(app.identityName, app.clientPubkey, Number(kind))}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1, padding: 0 }}
                        >×</button>
                      </span>
                    ))}
                </div>
                {explain && (
                  <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                    These specific event kinds override the rule above.  Remove one to return it to the default.
                  </p>
                )}
              </div>
            )}

            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Profile (kind 0) writes</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {PROFILE_OPTIONS.map(opt => {
                    const active = app.policies.profile === opt.value
                    return (
                      <button
                        key={opt.value}
                        aria-label={`Profile (kind 0) writes: ${opt.label}`}
                        aria-pressed={active}
                        onClick={() => onSetPolicy(app.identityName, app.clientPubkey, 'profile', opt.value)}
                        style={{
                          padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5,
                          fontWeight: active ? 700 : 400,
                          background: active ? 'var(--accent)' : 'var(--bg-secondary)',
                          color: active ? 'var(--on-accent)' : 'var(--text-primary)',
                        }}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              {explain && (
                <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '3px 0 0' }}>
                  Lets the app overwrite your name, picture and bio.  Off by default.
                </p>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12 }}>
              <button
                className="btn btn-ghost btn-sm"
                style={{ width: 'auto', padding: '4px 0', color: 'var(--text-secondary)' }}
                aria-label={`View activity for ${app.displayName}`}
                onClick={() => onViewActivity(app.identityName, app.clientPubkey)}
              >
                View activity ›
              </button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ width: 'auto', padding: '4px 0', color: 'var(--accent)' }}
                aria-label={`Copy bunker link for ${app.displayName}`}
                onClick={() => copyBunker(app.identityName, app.clientPubkey)}
              >
                {copiedKey === `${app.identityName}:${app.clientPubkey}` ? 'Copied!' : 'Copy bunker link'}
              </button>
            </div>
            {copyErrorKey === `${app.identityName}:${app.clientPubkey}` && (
              <p role="alert" style={{ color: 'var(--danger)', fontSize: 12, margin: '6px 0 0' }}>
                Could not copy. Select and copy the link manually.
              </p>
            )}
            {explain && (
              <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                Copies a fresh connection link to re-link this app, or set it up on another device.  Treat it like a password.
              </p>
            )}
          </div>
        ))
      )}
    </main>
  )
}
