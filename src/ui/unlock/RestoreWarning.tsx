import { useState } from 'react'

/** Gate in front of "Can't unlock? Restore" (H1). Restoring from the locked state is a full reset
 *  of this device: every identity, connected app, activity entry, profile and setting is erased
 *  before the restored key is saved. Nothing proceeds until the user ticks the acknowledgement. */
export function RestoreWarning({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false)
  return (
    <main className="page fade-in">
      <h2 style={{ fontWeight: 700, fontSize: 17, marginBottom: 12, textAlign: 'center' }}>Restore from a backup?</h2>
      <div className="card card-danger" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 18 }}>
        <p style={{ margin: '0 0 8px' }}>
          ⚠ Restoring will erase everything on this device: your identities, connected apps, activity,
          profiles and settings.
        </p>
        <p style={{ margin: 0 }}>
          The key currently on this device can't be recovered without its recovery phrase.{' '}
          <strong>This cannot be undone.</strong>
        </p>
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 22, fontSize: 14, lineHeight: 1.4, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={e => setAcknowledged(e.target.checked)}
          style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1, cursor: 'pointer' }}
        />
        I understand this erases everything on this device
      </label>
      <button
        className="btn btn-danger"
        style={{ width: '100%', marginBottom: 10 }}
        disabled={!acknowledged}
        onClick={onConfirm}
      >
        Erase and restore
      </button>
      <button className="btn btn-secondary" style={{ width: '100%' }} onClick={onCancel}>Cancel</button>
    </main>
  )
}
