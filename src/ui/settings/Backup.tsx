import { useState, useEffect } from 'react'
import { unlockWithPin, unlockWithBiometric, getRoot } from '../../app/auth.js'
import { PinPad } from '../components/PinPad'

const HIDE_AFTER_MS = 90_000

export function Backup({ biometricAvailable, onDone }: { biometricAvailable: boolean; onDone: () => void }) {
  const [words, setWords] = useState<string[] | null>(null)
  const [imported, setImported] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-hide after 90 seconds
  useEffect(() => {
    if (!words) return
    const timer = setTimeout(() => setWords(null), HIDE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [words])

  async function handlePin(pin: string) {
    setError(null)
    const masterKey = await unlockWithPin(pin)
    if (!masterKey) {
      setError('Wrong PIN — try again.')
      return
    }
    const root = await getRoot(masterKey)
    if (root.kind === 'nsec') setImported(true)
    else setWords(root.secret.split(' '))
  }

  async function handleBiometric() {
    setError(null)
    const masterKey = await unlockWithBiometric()
    if (!masterKey) {
      setError('Biometric unlock failed — try your PIN.')
      return
    }
    const root = await getRoot(masterKey)
    if (root.kind === 'nsec') setImported(true)
    else setWords(root.secret.split(' '))
  }

  if (imported) {
    return (
      <main className="page fade-in">
        <h2 style={{ fontWeight: 700, fontSize: 17, marginBottom: 16 }}>Imported identity</h2>
        <div className="card card-warning" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 16 }}>
          This identity was imported from an nsec.  It isn't part of a recovery phrase, so keep your original nsec safe.  Use Move to My Signet if you need to transfer it.
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onDone}>Done</button>
      </main>
    )
  }

  if (words) {
    return (
      <main className="page fade-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <h2 style={{ fontWeight: 700, fontSize: 17, margin: 0 }}>Recovery phrase</h2>
        </div>
        <div className="card card-warning" style={{ fontSize: 12, lineHeight: 1.45, marginBottom: 14 }}>
          ⚠ Never share these. Anyone who has them controls your identities.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 20 }}>
          {words.map((word, i) => (
            <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 9px', fontSize: 12.5, display: 'flex', gap: 7 }}>
              <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 14 }}>{i + 1}</span>
              <span style={{ fontWeight: 600 }}>{word}</span>
            </div>
          ))}
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onDone}>Done</button>
      </main>
    )
  }

  return (
    <main className="page fade-in">
      <h2 style={{ fontWeight: 700, fontSize: 17, marginBottom: 8, textAlign: 'center' }}>View recovery phrase</h2>
      <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12.5, lineHeight: 1.5, margin: '0 14px 22px' }}>
        Re-authenticate to reveal your recovery phrase.
      </p>
      {error && (
        <p role="alert" style={{ textAlign: 'center', color: 'var(--error, #c0392b)', fontSize: 13, marginBottom: 12 }}>{error}</p>
      )}
      <PinPad onComplete={pin => { void handlePin(pin) }} label="Enter your PIN" />
      {biometricAvailable && (
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
          <button
            className="btn btn-secondary"
            style={{ width: 'auto' }}
            onClick={() => { void handleBiometric() }}
          >
            Use Face ID
          </button>
        </div>
      )}
    </main>
  )
}
