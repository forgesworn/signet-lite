import { useEffect, useRef, useState } from 'react'
import { cancelPendingWebAuthnCeremony, unlockWithBiometric, unlockWithPin } from '../../app/auth.js'
import { PinPad } from '../components/PinPad'
import { Brand } from '../components/Brand'

const UNLOCK_ATTEMPT_TIMEOUT_MS = 20_000

export function Unlock({ biometricAvailable, onUnlocked, onRestore }: {
  biometricAvailable: boolean
  /** Open the session. May reject (e.g. a stored record can't be loaded); the screen then shows
   *  an error and accepts another attempt instead of going unresponsive. */
  onUnlocked: (masterKey: string) => void | Promise<void>
  /** Escape hatch: re-import the recovery phrase when unlock can't succeed (e.g. PRF/Face ID
   *  stopped working on this device). Without this, a PRF failure would be an unrecoverable lockout. */
  onRestore: () => void
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Unlock at most once. The auto Face ID attempt and a PIN entry can both resolve; the second
  // would otherwise call onUnlocked on an unmounting screen.
  const doneRef = useRef(false)
  const attemptRef = useRef(0)
  const timeoutRef = useRef<number | null>(null)
  function unlockOnce(mk: string) {
    if (doneRef.current) return
    doneRef.current = true
    clearAttemptTimeout()
    // M3: if opening the session fails after the key unwrapped, re-arm the screen and say so,
    // rather than leaving doneRef set so every later PIN / Face ID attempt is silently ignored.
    void Promise.resolve()
      .then(() => onUnlocked(mk))
      .catch(() => {
        doneRef.current = false
        setBusy(false)
        setError("Couldn't open your signet on this device. Try again; if it keeps failing, restore from your recovery phrase.")
      })
  }
  function clearAttemptTimeout() {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }
  function beginAttempt(): number {
    const attempt = attemptRef.current + 1
    attemptRef.current = attempt
    clearAttemptTimeout()
    setBusy(true)
    timeoutRef.current = window.setTimeout(() => {
      if (attemptRef.current !== attempt || doneRef.current) return
      attemptRef.current += 1
      timeoutRef.current = null
      cancelPendingWebAuthnCeremony()
      setBusy(false)
      setError('Unlock did not finish. Enter your PIN and approve Face ID if it appears, then try again.')
    }, UNLOCK_ATTEMPT_TIMEOUT_MS)
    return attempt
  }
  function finishAttempt(attempt: number): boolean {
    if (attemptRef.current !== attempt || doneRef.current) return false
    clearAttemptTimeout()
    setBusy(false)
    return true
  }
  function cancelAttempt() {
    attemptRef.current += 1
    clearAttemptTimeout()
    cancelPendingWebAuthnCeremony()
    setBusy(false)
    setError('Unlock cancelled. Enter your PIN and try again.')
  }

  useEffect(() => {
    if (!biometricAvailable) return
    void (async () => {
      const mk = await unlockWithBiometric()
      if (mk) unlockOnce(mk)
    })()
  }, [biometricAvailable]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    attemptRef.current += 1
    clearAttemptTimeout()
    cancelPendingWebAuthnCeremony()
  }, [])

  async function tryPin(pin: string) {
    const attempt = beginAttempt()
    setError('')
    // unlockWithPin runs its own WebAuthn ceremony (when quick unlock is on); auth.ts serialises
    // ceremonies, so this supersedes any pending auto Face ID rather than colliding with it.
    const mk = await unlockWithPin(pin)
    if (!finishAttempt(attempt)) return
    if (mk) unlockOnce(mk)
    else setError("Couldn't unlock — check your PIN, and approve Face ID if it appears, then try again.")
  }

  return (
    <main className="page">
      <Brand />
      <h2 style={{ textAlign: 'center', marginTop: 16 }}>Unlock My Signet Lite</h2>
      <div style={{ marginTop: 16 }}><PinPad onComplete={tryPin} disabled={busy} label="Enter your PIN" /></div>
      {busy && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 8px' }}>
            Waiting for secure unlock…
          </p>
          <button className="btn btn-secondary btn-sm" type="button" onClick={cancelAttempt}>
            Cancel unlock
          </button>
        </div>
      )}
      {error && <p style={{ color: 'var(--danger)', textAlign: 'center' }}>{error}</p>}
      <button
        className="btn btn-ghost"
        style={{ width: '100%', marginTop: 12, fontSize: 13 }}
        disabled={busy}
        onClick={onRestore}
      >
        Can't unlock? Restore from your recovery phrase
      </button>
    </main>
  )
}
