import { useState } from 'react'
import { PinPad } from '../components/PinPad'

export function SetupUnlock({
  biometricAvailable,
  onPin,
  onBiometric,
  busy,
  error,
}: {
  biometricAvailable: boolean
  onPin: (pin: string) => void
  onBiometric: () => void
  busy?: boolean
  error?: string
}) {
  const [showPin, setShowPin] = useState(false)

  return (
    <main className="page">
      <div style={{ width: 72, height: 72, borderRadius: 18, border: '2px solid var(--accent)', margin: '18px auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, color: 'var(--accent)' }}>
        ⊙
      </div>
      <h2 style={{ textAlign: 'center', fontWeight: 700, fontSize: 17 }}>Lock your signer</h2>
      <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12.5, lineHeight: 1.5, margin: '8px 14px 22px' }}>
        {biometricAvailable
          ? "Use Face ID for secure quick unlock. We'll also set a PIN, but your browser database cannot be tested against the PIN alone."
          : "Set a 6-digit PIN to protect your signer. PIN-only unlock protects normal use, but secure hardware gives stronger protection if browser data is copied."}
      </p>
      {error && <p role="alert" style={{ color: 'var(--danger)', textAlign: 'center', fontSize: 13, margin: '0 0 14px' }}>{error}</p>}

      {biometricAvailable && !showPin ? (
        <>
          <button className="btn btn-primary" disabled={busy} onClick={onBiometric}>
            Turn on Face ID
          </button>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} disabled={busy} onClick={() => setShowPin(true)}>
            Use a PIN instead
          </button>
        </>
      ) : (
        <>
          <div className="card card-warning" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 14 }}>
            A PIN-only setup can still be attacked offline if someone gets a copy of this browser's data. Use secure quick unlock on devices that support it, or upgrade later from Settings after backing up your recovery phrase.
          </div>
          <PinPad onComplete={onPin} disabled={busy} label="Enter a 6-digit PIN" />
        </>
      )}
    </main>
  )
}
