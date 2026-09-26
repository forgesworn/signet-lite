import { useState } from 'react'
import { QrScanner } from './QrScanner'
import { parseScannedConnect } from './scan-connect.js'
import { parseNostrConnectURI } from '../../engine/nip46.js'
import { appNameFromUri } from '../connect-app.js'
import { ConnectConfirm } from './ConnectConfirm.js'
import { CameraIcon, PlusIcon } from '../components/icons.js'
import { Hint } from '../components/Hint'

type Mode = 'choose' | 'paste' | 'confirm' | 'bunker-persona'

export function Connect({ identities, explain, onConnect, onBunker, onCancel, error }: {
  identities: { name: string }[]
  explain: boolean
  onConnect: (uri: string, identityName: string, askEachTime: boolean) => void
  onBunker: (identityName: string) => void
  onCancel: () => void
  error?: string
}) {
  const [mode, setMode] = useState<Mode>('choose')
  const [uri, setUri] = useState('')
  const [scanning, setScanning] = useState(false)
  const [parseError, setParseError] = useState('')
  const [bunkerName, setBunkerName] = useState(identities[0]?.name ?? '')

  function handleContinue() {
    const trimmed = uri.trim()
    if (!trimmed) return
    if (!parseNostrConnectURI(trimmed)) {
      setParseError('That connection link is not valid.')
      return
    }
    setParseError('')
    setMode('confirm')
  }

  if (mode === 'choose') {
    return (
      <main className="page fade-in">
        <h2 className="section-title">Connect an app</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 0, marginBottom: 16 }}>
          How would you like to connect?
        </p>

        <Hint show={explain}>
          Apps connect so they can post or read messages as you.  They never see your secret key.  If the app shows a link or QR code, choose the first option.  If you want the app to scan a code from your phone, choose the second.
        </Hint>

        <div className="card" style={{ marginBottom: 12 }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            onClick={() => { setParseError(''); setMode('paste') }}
          >
            <CameraIcon size={18} /> Scan or paste a link
          </button>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            onClick={() => { setBunkerName(identities[0]?.name ?? ''); setMode('bunker-persona') }}
          >
            <PlusIcon size={18} /> Create a link for an app
          </button>
        </div>

        <button className="btn btn-ghost" style={{ width: '100%' }} onClick={onCancel}>
          Cancel
        </button>
      </main>
    )
  }

  if (mode === 'bunker-persona') {
    return (
      <main className="page fade-in">
        <h2 className="section-title">Create a link</h2>
        <div className="card" style={{ marginBottom: 16 }}>
          <label htmlFor="bunker-identity" style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
            This link signs in as
          </label>
          <select
            id="bunker-identity"
            className="input"
            value={bunkerName}
            onChange={e => setBunkerName(e.target.value)}
          >
            {identities.map(id => (
              <option key={id.name} value={id.name}>{id.name}</option>
            ))}
          </select>
        </div>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: 8 }}
          disabled={!bunkerName}
          onClick={() => onBunker(bunkerName)}
        >
          Create link
        </button>
        <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => setMode('choose')}>
          Back
        </button>
      </main>
    )
  }

  if (mode === 'confirm') {
    const req = parseNostrConnectURI(uri.trim())
    // handleContinue guarantees a parseable URI before this mode is entered.
    const app = req
      ? { name: appNameFromUri(req), url: req.appUrl }
      : { name: 'Unknown app', url: undefined }
    return (
      <ConnectConfirm
        app={app}
        identities={identities}
        explain={explain}
        onConnect={(identityName, askEachTime) => onConnect(uri.trim(), identityName, askEachTime)}
        onCancel={() => setMode('paste')}
        error={error}
      />
    )
  }

  // paste mode — show the camera scanner when requested
  if (scanning) {
    return (
      <QrScanner
        accept={parseScannedConnect}
        onResult={value => { setUri(value); setScanning(false) }}
        onCancel={() => setScanning(false)}
      />
    )
  }

  return (
    <main className="page fade-in">
      <h2 className="section-title">Connect an app</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 0, marginBottom: 16 }}>
        Scan the app's QR code, or paste its connection link.
      </p>

      <button
        className="btn btn-secondary"
        style={{ width: '100%', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        onClick={() => setScanning(true)}
      >
        <CameraIcon size={18} /> Scan QR code
      </button>

      <div className="card" style={{ marginBottom: 16 }}>
        <label htmlFor="connect-uri" style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
          Connection link
        </label>
        <textarea
          id="connect-uri"
          className="input"
          rows={3}
          value={uri}
          onChange={e => { setUri(e.target.value); setParseError('') }}
          placeholder="nostrconnect://..."
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
        />
      </div>

      {(parseError || error) && (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{parseError || error}</p>
      )}

      <button
        className="btn btn-primary"
        style={{ width: '100%', marginBottom: 8 }}
        disabled={!uri.trim()}
        onClick={handleContinue}
      >
        Continue
      </button>
      <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => setMode('choose')}>
        Back
      </button>
    </main>
  )
}
