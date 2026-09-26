import { useEffect, useMemo, useState } from 'react'
import { getRoot, unlockWithBiometric, unlockWithPin } from '../../app/auth.js'
import { PinPad } from '../components/PinPad'

const HIDE_AFTER_MS = 90_000

interface MoveIdentity {
  name: string
  npub: string
  displayName?: string
}

export function MoveToMySignet({
  identities,
  biometricAvailable,
  onDone,
}: {
  identities: MoveIdentity[]
  biometricAvailable: boolean
  onDone: () => void
}) {
  const [selectedName, setSelectedName] = useState(() => identities[0]?.name ?? '')
  // A mnemonic identity moves with its 12 words.  An nsec-imported identity is NEVER
  // re-revealed by Lite: the owner already holds the nsec they imported, so we just point
  // them at it.  There is no nsec-export path.
  const [transfer, setTransfer] = useState<
    | { kind: 'mnemonic'; words: string; identityName: string }
    | { kind: 'nsec-original' }
    | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [cleared, setCleared] = useState(false)
  const selected = useMemo(
    () => identities.find(i => i.name === selectedName) ?? identities[0],
    [identities, selectedName],
  )

  // Auto-hide the revealed mnemonic after 90 seconds, same as Backup — a revealed recovery
  // phrase left on screen indefinitely is a shoulder-surfing risk.
  useEffect(() => {
    if (transfer?.kind !== 'mnemonic') return
    const timer = setTimeout(() => setTransfer(null), HIDE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [transfer])

  async function revealAfterPin(pin: string) {
    setError(null)
    const masterKey = await unlockWithPin(pin)
    if (!masterKey) {
      setError('Wrong PIN - try again.')
      return
    }
    await reveal(masterKey)
  }

  async function revealAfterBiometric() {
    setError(null)
    const masterKey = await unlockWithBiometric()
    if (!masterKey) {
      setError('Biometric unlock failed - try your PIN.')
      return
    }
    await reveal(masterKey)
  }

  async function reveal(masterKey: string) {
    try {
      if (!selected) throw new Error('Choose an identity first.')
      const root = await getRoot(masterKey)
      if (root.kind === 'mnemonic') {
        setTransfer({ kind: 'mnemonic', words: root.secret, identityName: selected.name })
      } else {
        // nsec-imported install: show guidance only.  Lite never reveals the private key.
        setTransfer({ kind: 'nsec-original' })
      }
      setCopied(false)
      setCleared(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare this identity.')
    }
  }

  async function copyTransfer() {
    if (!transfer || transfer.kind !== 'mnemonic') return
    const text = `Signet Lite recovery phrase:\n${transfer.words}\n\nLite identity name:\n${transfer.identityName}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setCleared(false)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Could not copy.  Select and copy the phrase manually.')
    }
  }

  async function clearClipboard() {
    try {
      await navigator.clipboard.writeText('')
      setCleared(true)
    } catch {
      setError('Could not clear the clipboard from here.')
    }
  }

  function openMySignet() {
    window.open('https://mysignet.app', '_blank', 'noopener,noreferrer')
  }

  if (!selected) {
    return (
      <main className="page fade-in">
        <h2 style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Move to My Signet</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
          No identities are available to move.
        </p>
        <button className="btn btn-primary" onClick={onDone}>Done</button>
      </main>
    )
  }

  if (transfer?.kind === 'nsec-original') {
    return (
      <main className="page fade-in">
        <h2 style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Move to My Signet</h2>
        <div className="card card-warning" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 14 }}>
          This identity was imported from a private key (nsec).  Signet Lite never reveals it.  Set it up in My Signet using the original nsec you imported and kept.
        </div>
        <button className="btn btn-secondary" style={{ width: '100%', marginBottom: 8 }} onClick={openMySignet}>
          Open My Signet
        </button>
        <button className="btn btn-ghost" style={{ width: '100%' }} onClick={onDone}>
          Done
        </button>
      </main>
    )
  }

  if (transfer?.kind === 'mnemonic') {
    return (
      <main className="page fade-in">
        <h2 style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Move to My Signet</h2>
        <div className="card card-warning" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 14 }}>
          Use these in My Signet: I already have a Signet, then Restore from Signet Lite.
        </div>
        <label htmlFor="move-words" className="section-title" style={{ display: 'block', marginBottom: 6, textTransform: 'none' }}>
          Lite recovery phrase
        </label>
        <textarea
          id="move-words"
          className="input"
          readOnly
          value={transfer.words}
          rows={4}
          spellCheck={false}
          autoCorrect="off"
          style={{ resize: 'none', fontFamily: 'monospace', fontSize: 12, marginBottom: 12 }}
        />
        <label htmlFor="move-identity-name" className="section-title" style={{ display: 'block', marginBottom: 6, textTransform: 'none' }}>
          Lite identity name
        </label>
        <input
          id="move-identity-name"
          className="input"
          readOnly
          value={transfer.identityName}
          style={{ marginBottom: 12 }}
        />
        {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}
        <button className="btn btn-primary" style={{ width: '100%', marginBottom: 8 }} onClick={() => { void copyTransfer() }}>
          {copied ? 'Copied' : 'Copy restore details'}
        </button>
        <button className="btn btn-secondary" style={{ width: '100%', marginBottom: 8 }} onClick={openMySignet}>
          Open My Signet
        </button>
        <button className="btn btn-ghost" style={{ width: '100%', marginBottom: 8 }} onClick={() => { void clearClipboard() }}>
          {cleared ? 'Clipboard cleared' : 'Clear clipboard'}
        </button>
        <button className="btn btn-ghost" style={{ width: '100%' }} onClick={onDone}>
          Done
        </button>
      </main>
    )
  }

  return (
    <main className="page fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <button
          className="btn btn-ghost"
          aria-label="Back"
          style={{ width: 'auto', padding: '6px 10px', fontSize: 18 }}
          onClick={onDone}
        >
          ←
        </button>
        <h1 className="section-title" style={{ margin: 0 }}>Move to My Signet</h1>
      </div>

      <div className="card card-warning" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 14 }}>
        This prepares one Lite identity for My Signet.  Recovery-phrase identities move with the same 12 words and identity name.  An identity you imported from an nsec is set up in My Signet using that original nsec - Lite never reveals it.
      </div>

      <label htmlFor="move-identity" className="section-title" style={{ display: 'block', marginBottom: 6, textTransform: 'none' }}>
        Identity
      </label>
      <select
        id="move-identity"
        className="input"
        value={selected.name}
        onChange={e => setSelectedName(e.target.value)}
        style={{ marginBottom: 12 }}
      >
        {identities.map(id => (
          <option key={id.name} value={id.name}>
            {id.displayName ?? id.name}
          </option>
        ))}
      </select>
      <p style={{ fontFamily: 'monospace', fontSize: 12, margin: '0 0 18px', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
        {selected.npub}
      </p>

      {error && <p role="alert" style={{ color: 'var(--danger)', textAlign: 'center', fontSize: 13, margin: '0 0 14px' }}>{error}</p>}
      <PinPad onComplete={pin => { void revealAfterPin(pin) }} label="Enter your PIN" />
      {biometricAvailable && (
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
          <button
            className="btn btn-secondary"
            style={{ width: 'auto' }}
            onClick={() => { void revealAfterBiometric() }}
          >
            Use Face ID
          </button>
        </div>
      )}
    </main>
  )
}
