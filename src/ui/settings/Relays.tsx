import { useState } from 'react'

export function Relays({
  relays,
  onAdd,
  onRemove,
  onBack,
  error,
  blossomServer,
  blossomError,
  onSetBlossom,
}: {
  relays: string[]
  onAdd: (url: string) => void
  onRemove: (url: string) => void
  onBack: () => void
  error?: string
  blossomServer: string
  blossomError?: string
  onSetBlossom: (url: string) => void
}) {
  const [inputValue, setInputValue] = useState('')
  const [blossomInput, setBlossomInput] = useState(blossomServer)

  function handleAdd() {
    onAdd(inputValue)
    setInputValue('')
  }

  return (
    <main className="page fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <button
          className="btn btn-ghost"
          aria-label="Back"
          style={{ width: 'auto', padding: '6px 10px', fontSize: 18 }}
          onClick={onBack}
        >
          ←
        </button>
        <h1 className="section-title" style={{ margin: 0 }}>Relays</h1>
      </div>

      {/* Current relay list */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        {relays.map((relay, i) => (
          <div
            key={relay}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderBottom: i < relays.length - 1 ? '1px solid var(--border)' : 'none',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {relay}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              style={{ width: 'auto' }}
              disabled={relays.length <= 1}
              onClick={() => onRemove(relay)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {/* Add relay */}
      <div className="card" style={{ marginBottom: 0 }}>
        <label htmlFor="relay-input" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
          Add relay
        </label>
        <input
          id="relay-input"
          className="input"
          type="url"
          placeholder="wss://relay.example.com"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
          style={{ marginBottom: 8 }}
        />
        {error && (
          <p role="alert" style={{ fontSize: 13, color: 'var(--danger)', margin: '0 0 8px' }}>{error}</p>
        )}
        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={handleAdd}
        >
          Add
        </button>
      </div>

      {/* Blossom image server */}
      <div className="card" style={{ marginTop: 16 }}>
        <label htmlFor="blossom-input" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
          Image server
        </label>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.4 }}>
          Where your profile pictures are uploaded (a Blossom server). The default works out of the box.
        </p>
        <input
          id="blossom-input"
          className="input"
          type="url"
          placeholder="https://blossom.band"
          value={blossomInput}
          onChange={e => setBlossomInput(e.target.value)}
          onBlur={() => onSetBlossom(blossomInput.trim())}
          onKeyDown={e => { if (e.key === 'Enter') onSetBlossom(blossomInput.trim()) }}
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
        {blossomError && (
          <p role="alert" style={{ fontSize: 13, color: 'var(--danger)', margin: '8px 0 0' }}>{blossomError}</p>
        )}
      </div>
    </main>
  )
}
