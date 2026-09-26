import { useState } from 'react'
import { GlobeIcon } from '../components/icons.js'
import { Hint } from '../components/Hint'

export function ConnectConfirm({ app, identities, explain, onConnect, onCancel, error }: {
  app: { name: string; url?: string }
  identities: { name: string }[]
  explain: boolean
  onConnect: (identityName: string, askEachTime: boolean) => void
  onCancel: () => void
  error?: string
}) {
  const [selectedName, setSelectedName] = useState(identities[0]?.name ?? '')
  const [askEachTime, setAskEachTime] = useState(true)

  return (
    <main className="page fade-in">
      <h2 className="section-title">Connect app</h2>

      <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <GlobeIcon size={28} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: 15, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.name}</p>
          {app.url && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.url}</p>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <label htmlFor="confirm-identity" style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
          Sign in as
        </label>
        <select
          id="confirm-identity"
          className="input"
          value={selectedName}
          onChange={e => setSelectedName(e.target.value)}
        >
          {identities.map(id => (
            <option key={id.name} value={id.name}>{id.name}</option>
          ))}
        </select>
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5, marginTop: 0, marginBottom: 16 }}>
        {app.name} can ask to post or read encrypted messages as {selectedName}.  You can remove it any time in Settings.
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 20 }}>
        <input type="checkbox" checked={askEachTime} onChange={e => setAskEachTime(e.target.checked)} />
        Ask before each action
      </label>

      <Hint show={explain}>
        Leave this on unless you trust the app. Turning it off lets the app sign posts and read or write encrypted messages without prompts; profile changes still stay off until you allow them in Settings.
      </Hint>

      {error && (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>
      )}
      <button
        className="btn btn-primary"
        style={{ width: '100%', marginBottom: 8 }}
        disabled={!selectedName}
        onClick={() => onConnect(selectedName, askEachTime)}
      >
        Connect as {selectedName}
      </button>
      <button className="btn btn-ghost" style={{ width: '100%' }} onClick={onCancel}>
        Cancel
      </button>
    </main>
  )
}
