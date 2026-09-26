import { useState } from 'react'

/** A 6-digit numeric entry pad. Fires onComplete once six digits are entered, then clears. */
export function PinPad({ onComplete, disabled, label }: { onComplete: (pin: string) => void; disabled?: boolean; label?: string }) {
  const [pin, setPin] = useState('')
  function push(d: string) {
    if (disabled) return
    const next = (pin + d).slice(0, 6)
    setPin(next)
    if (next.length === 6) { onComplete(next); setPin('') }
  }
  return (
    <div>
      {label && <p className="section-title" style={{ textAlign: 'center' }}>{label}</p>}
      <div aria-label="PIN entry" style={{ display: 'flex', gap: 10, justifyContent: 'center', margin: '12px 0 20px' }}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: i < pin.length ? 'var(--accent)' : 'var(--border)' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, maxWidth: 260, margin: '0 auto' }}>
        {['1','2','3','4','5','6','7','8','9'].map(d => (
          <button key={d} className="btn btn-secondary signet-pinpad-key" disabled={disabled} onClick={() => push(d)}>{d}</button>
        ))}
        <span />
        <button className="btn btn-secondary signet-pinpad-key" disabled={disabled} onClick={() => push('0')}>0</button>
        <button className="btn btn-ghost" disabled={disabled} aria-label="Delete" onClick={() => setPin(p => p.slice(0, -1))}>⌫</button>
      </div>
    </div>
  )
}
