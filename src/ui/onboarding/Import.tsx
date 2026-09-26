import { useState } from 'react'
import { isValidMnemonic } from '../../app/mnemonic-import.js'
import { isValidNsec, isValidNcryptsec, ncryptsecToNsec } from '../../engine/nsec.js'

export function Import({ onValid, onBack }: { onValid: (secret: string, name: string, kind: 'mnemonic' | 'nsec') => void; onBack: () => void }) {
  const [mode, setMode] = useState<'words' | 'nsec' | 'ncryptsec'>('words')
  const [text, setText] = useState('')
  const [password, setPassword] = useState('')
  const [decryptError, setDecryptError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [name, setName] = useState('default')
  const nameOk = name.trim().length > 0

  const normalisedWords = text.trim().toLowerCase().replace(/\s+/g, ' ')
  const nsecValue = text.trim()
  const valid =
    mode === 'words' ? isValidMnemonic(text) :
    mode === 'nsec' ? isValidNsec(nsecValue) :
    isValidNcryptsec(nsecValue) && password.length > 0
  const showError = text.length > 0 && !valid && mode !== 'ncryptsec'

  function submit() {
    if (mode === 'words') {
      onValid(normalisedWords, name.trim(), 'mnemonic')
    } else if (mode === 'nsec') {
      onValid(nsecValue, name.trim(), 'nsec')
    } else {
      try {
        const nsec = ncryptsecToNsec(text.trim(), password)
        onValid(nsec, name.trim(), 'nsec')
      } catch {
        setDecryptError('That password did not unlock this key.  Check it and try again.')
      }
    }
  }

  function switchMode(next: 'words' | 'nsec' | 'ncryptsec') {
    setMode(next)
    setText('')
    setPassword('')
    setDecryptError('')
    setShowPassword(false)
  }

  return (
    <main className="page">
      <h2>Restore from a backup</h2>
      <p className="section-title" style={{ textTransform: 'none' }}>Name this identity, then restore it.</p>
      <label htmlFor="id-name" className="section-title" style={{ display: 'block', marginTop: 12, textTransform: 'none' }}>Identity name</label>
      <input id="id-name" className="input" value={name} onChange={e => setName(e.target.value)}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} />

      {mode === 'words' ? (
        <>
          <label htmlFor="id-phrase" className="section-title" style={{ display: 'block', marginTop: 12, textTransform: 'none' }}>Recovery phrase (12 words)</label>
          <textarea id="id-phrase" aria-label="Recovery phrase" className="input" rows={4} value={text} onChange={e => setText(e.target.value)}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          {showError && <p style={{ color: 'var(--danger)', marginTop: 8, fontSize: 13 }}>That's not a valid recovery phrase.</p>}
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => switchMode('nsec')}>Have an nsec instead?</button>
        </>
      ) : mode === 'nsec' ? (
        <>
          <label htmlFor="id-nsec" className="section-title" style={{ display: 'block', marginTop: 12, textTransform: 'none' }}>Your nsec</label>
          <input id="id-nsec" aria-label="Your nsec" className="input" value={text} onChange={e => setText(e.target.value)}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: 12.5, lineHeight: 1.5 }}>
            Paste this somewhere private.  Anyone with your nsec controls this identity.
          </p>
          {showError && <p style={{ color: 'var(--danger)', marginTop: 8, fontSize: 13 }}>That's not a valid nsec.  It should start with nsec1.</p>}
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => switchMode('words')}>Use a 12-word phrase instead?</button>
          <button className="btn btn-ghost" style={{ marginTop: 4 }} onClick={() => switchMode('ncryptsec')}>Have an encrypted key (ncryptsec)?</button>
        </>
      ) : (
        <>
          <label htmlFor="id-ncryptsec" className="section-title" style={{ display: 'block', marginTop: 12, textTransform: 'none' }}>Encrypted key (ncryptsec)</label>
          <input id="id-ncryptsec" aria-label="Encrypted key (ncryptsec)" className="input" value={text} onChange={e => { setText(e.target.value); setDecryptError('') }}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <label htmlFor="id-password" className="section-title" style={{ display: 'block', marginTop: 12, textTransform: 'none' }}>Password</label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input id="id-password" aria-label="Password" type={showPassword ? 'text' : 'password'} className="input" value={password} onChange={e => { setPassword(e.target.value); setDecryptError('') }}
              autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ flex: 1, paddingRight: '2.5rem' }} />
            <button
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword(v => !v)}
              style={{ position: 'absolute', right: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '0.25rem', lineHeight: 1 }}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>
          {decryptError && <p style={{ color: 'var(--danger)', marginTop: 8, fontSize: 13 }}>{decryptError}</p>}
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => switchMode('nsec')}>Use a plain nsec instead?</button>
        </>
      )}

      <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={!valid || !nameOk} onClick={submit}>Continue</button>
      <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onBack}>Back</button>
    </main>
  )
}
