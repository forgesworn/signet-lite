import { useState } from 'react'
import { Hint } from './components/Hint'

export function Home({ identities, explain, keepAwake, rootIdentityName, onAddIdentity, onDeleteIdentity, onEditProfile, onConnect, onSettings, onLock }: {
  identities: { name: string; npub: string; displayName?: string; avatarUrl?: string }[]
  explain: boolean
  /** True while Lite is holding the screen awake so connected apps can reach it. */
  keepAwake?: boolean
  /** The nsec master's root identity name, if any: it cannot be deleted. */
  rootIdentityName?: string
  onAddIdentity: (name: string) => Promise<void>
  onDeleteIdentity: (name: string) => void
  onEditProfile: (name: string) => void
  onConnect: () => void
  onSettings: () => void
  onLock: () => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  // Copy the public npub (never the secret key — Lite has no UI path that exposes an nsec) with
  // brief on-screen confirmation.
  function copyNpub(npub: string) {
    void navigator.clipboard.writeText(npub)
    setCopied(npub)
    setTimeout(() => setCopied(c => (c === npub ? null : c)), 1500)
  }

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return
    setAddError(null)
    try {
      await onAddIdentity(name)
      setNewName('')
      setShowAdd(false)
    } catch (err) {
      // Shown inline, never an unhandled rejection: the form stays open with the name intact
      // so the user can correct it (e.g. a duplicate name) and retry.
      setAddError(err instanceof Error ? err.message : 'Could not add that identity. Please try again.')
    }
  }

  function handleDeleteConfirm(name: string) {
    onDeleteIdentity(name)
    setConfirmDelete(null)
  }

  return (
    <main className="page fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h1 className="section-title" style={{ margin: 0 }}>Your identities</h1>
        <button
          className="btn btn-ghost"
          aria-label="Settings"
          style={{ width: 'auto', padding: '6px 10px', fontSize: 18 }}
          onClick={onSettings}
        >
          ⚙
        </button>
      </div>

      <Hint show={explain}>
        Your <strong>npub</strong> is your public Nostr name — safe to share with anyone. Tap Copy to share it.
        Your secret key never leaves this device and can't be copied. "Connect an app" lets a site post as you,
        with your approval.
      </Hint>

      {identities.map(id => (
        <div className="card" key={id.npub} style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              aria-hidden
              style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: 'var(--bg-secondary)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {id.avatarUrl
                ? <img src={id.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-muted)' }}>{id.name.slice(0, 1).toUpperCase()}</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <p style={{ fontWeight: 700, margin: 0 }}>{id.displayName ?? id.name}</p>
              <p
                data-testid="identity-npub"
                style={{ fontFamily: 'monospace', fontSize: 12, margin: '2px 0 0', color: 'var(--text-secondary)', wordBreak: 'break-all' }}
              >{id.npub}</p>
            </div>
            <button
              className="btn btn-ghost"
              style={{ flexShrink: 0, fontSize: 12, width: 'auto' }}
              onClick={() => copyNpub(id.npub)}
            >
              {copied === id.npub ? 'Copied' : 'Copy'}
            </button>
          </div>

          {confirmDelete !== id.name && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                className="btn btn-ghost"
                style={{ width: 'auto', fontSize: 12, padding: '6px 10px' }}
                onClick={() => onEditProfile(id.name)}
              >
                Edit profile
              </button>
              {identities.length > 1 && id.name !== rootIdentityName && (
                <button
                  className="btn btn-ghost"
                  style={{ width: 'auto', fontSize: 12, padding: '6px 10px', color: 'var(--text-secondary)' }}
                  onClick={() => setConfirmDelete(id.name)}
                >
                  Delete
                </button>
              )}
            </div>
          )}

          {confirmDelete === id.name && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, flex: 1 }}>Remove {id.name}?</span>
              <button
                className="btn btn-ghost"
                style={{ width: 'auto', color: 'var(--error, #e55)' }}
                onClick={() => handleDeleteConfirm(id.name)}
              >
                Remove
              </button>
              <button
                className="btn btn-ghost"
                style={{ width: 'auto' }}
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      ))}

      {showAdd ? (
        <div className="card" style={{ marginTop: 12 }}>
          <label htmlFor="new-identity-name" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            New identity name
          </label>
          <input
            id="new-identity-name"
            className="input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            placeholder="e.g. work"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleAdd() }}
            autoFocus
          />
          {addError && (
            <p style={{ color: 'var(--danger)', fontSize: 13, margin: '8px 0 0' }}>{addError}</p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary" style={{ flex: 1, width: 'auto' }} onClick={() => void handleAdd()}>Add</button>
            <button className="btn btn-ghost" style={{ width: 'auto' }} onClick={() => { setShowAdd(false); setNewName(''); setAddError(null) }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button
          className="btn btn-secondary"
          style={{ marginTop: 12, width: '100%' }}
          onClick={() => { setShowAdd(true); setAddError(null) }}
        >
          + Add identity
        </button>
      )}

      <button
        className="btn btn-primary"
        style={{ marginTop: 24, width: '100%' }}
        onClick={onConnect}
      >
        Connect an app
      </button>

      <button
        className="btn btn-ghost"
        style={{ marginTop: 8, width: '100%' }}
        onClick={onLock}
      >
        Lock now
      </button>

      {keepAwake && (
        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          Keeping the screen awake so connected apps can reach you.
        </p>
      )}
    </main>
  )
}
