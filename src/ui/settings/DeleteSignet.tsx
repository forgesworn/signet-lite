import { useState } from 'react'

/** Confirmation screen for an irreversible factory-reset. The delete button stays disabled
 *  until the user explicitly acknowledges they've saved their recovery phrase — without it the
 *  identities are unrecoverable. */
export function DeleteSignet({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false)
  return (
    <main className="page fade-in">
      <h2 style={{ fontWeight: 700, fontSize: 17, marginBottom: 12, textAlign: 'center' }}>Delete your signet?</h2>
      <div className="card card-danger" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 18 }}>
        ⚠ This permanently removes your identities and connections from this device. You can only
        restore them with your recovery phrase. <strong>This cannot be undone.</strong>
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 22, fontSize: 14, lineHeight: 1.4, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={e => setAcknowledged(e.target.checked)}
          style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1, cursor: 'pointer' }}
        />
        I've saved my recovery phrase
      </label>
      <button
        className="btn btn-danger"
        style={{ width: '100%', marginBottom: 10 }}
        disabled={!acknowledged}
        onClick={onConfirm}
      >
        Yes, delete everything
      </button>
      <button className="btn btn-secondary" style={{ width: '100%' }} onClick={onCancel}>Cancel</button>
    </main>
  )
}
