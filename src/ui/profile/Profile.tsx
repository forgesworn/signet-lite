import { useRef, useState } from 'react'
import { Hint } from '../components/Hint'
import type { ProfileMetadata } from '../../app/db.js'

const FIELDS: { key: keyof ProfileMetadata; label: string; placeholder: string; multiline?: boolean }[] = [
  { key: 'name', label: 'Name', placeholder: 'Your display name' },
  { key: 'about', label: 'Bio', placeholder: 'A sentence or two about you', multiline: true },
  { key: 'website', label: 'Website', placeholder: 'https://…' },
  { key: 'nip05', label: 'Verified address (NIP-05)', placeholder: 'you@example.com' },
  { key: 'lud16', label: 'Lightning address', placeholder: 'you@walletofsatoshi.com' },
]

export function Profile({ identityName, explain, initialMetadata, initialAvatarUrl, loading, saving, error, onSave, onBack }: {
  identityName: string
  explain: boolean
  initialMetadata: ProfileMetadata
  initialAvatarUrl?: string
  loading: boolean
  saving: boolean
  error?: string
  onSave: (metadata: ProfileMetadata, newAvatar?: Blob) => void
  onBack: () => void
}) {
  const [meta, setMeta] = useState<ProfileMetadata>(initialMetadata)
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(initialAvatarUrl)
  const [newAvatar, setNewAvatar] = useState<Blob | undefined>(undefined)
  const fileRef = useRef<HTMLInputElement>(null)

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setNewAvatar(file)
    setAvatarUrl(URL.createObjectURL(file))
  }

  return (
    <main className="page fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button className="btn btn-ghost" aria-label="Back" style={{ width: 'auto', padding: '6px 10px', fontSize: 18 }} onClick={onBack}>←</button>
        <h1 className="section-title" style={{ margin: 0 }}>Edit profile</h1>
      </div>

      <Hint show={explain}>
        This is how you appear across Nostr apps — for the <strong>{identityName}</strong> identity. Fill in
        what you like and tap Save; it's published for you, and you can change it any time.
      </Hint>

      {loading ? (
        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14, marginTop: 24 }}>Loading your profile…</p>
      ) : (
        <>
          {/* Avatar */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{ width: 96, height: 96, borderRadius: '50%', overflow: 'hidden', background: 'var(--bg-secondary)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {avatarUrl
                ? <img src={avatarUrl} alt="Profile picture" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 34, color: 'var(--text-muted)' }}>＋</span>}
            </div>
            <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={() => fileRef.current?.click()}>
              {avatarUrl ? 'Change photo' : 'Add a photo'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" aria-label="Profile picture" style={{ display: 'none' }} onChange={pickFile} />
          </div>

          {/* Fields */}
          {FIELDS.map(f => (
            <div key={f.key} style={{ marginBottom: 14 }}>
              <label htmlFor={`pf-${f.key}`} style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{f.label}</label>
              {f.multiline ? (
                <textarea
                  id={`pf-${f.key}`} className="input" rows={3}
                  value={meta[f.key] ?? ''} placeholder={f.placeholder}
                  onChange={e => setMeta(m => ({ ...m, [f.key]: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
                />
              ) : (
                <input
                  id={`pf-${f.key}`} className="input"
                  value={meta[f.key] ?? ''} placeholder={f.placeholder}
                  autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  onChange={e => setMeta(m => ({ ...m, [f.key]: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              )}
            </div>
          ))}

          {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}

          <button
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 6 }}
            disabled={saving}
            onClick={() => onSave(meta, newAvatar)}
          >
            {saving ? 'Publishing…' : 'Save & publish'}
          </button>
        </>
      )}
    </main>
  )
}
