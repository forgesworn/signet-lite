import { useState, useEffect } from 'react'
import * as QRCode from 'qrcode'

export function Bunker({ uri, appName, identityName, onManageApps, onDone }: {
  uri: string
  appName?: string
  identityName?: string
  onManageApps: () => void
  onDone: () => void
}) {
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void QRCode.toDataURL(uri).then(setQr)
  }, [uri])

  function handleCopy() {
    setError(null)
    navigator.clipboard.writeText(uri).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      setError('Could not copy. Select and copy the link manually.')
    })
  }

  return (
    <main className="page fade-in">
      <h2 className="section-title">Connect an app</h2>

      {identityName && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 13, margin: 0, marginBottom: 6 }}>
            Any app that opens this link signs in as {identityName}.
          </p>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0 }}>
            Keep it private.  Treat it like a password.
          </p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Bunker link</p>
        <p
          data-testid="bunker-uri"
          style={{
            fontFamily: 'monospace',
            fontSize: 11,
            wordBreak: 'break-all',
            color: 'var(--text-secondary)',
            marginBottom: 10,
          }}
        >
          {uri}
        </p>
        <button
          className="btn btn-primary"
          style={{ width: 'auto' }}
          onClick={handleCopy}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
        {error && (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 12.5, margin: '8px 0 0' }}>{error}</p>
        )}
      </div>

      {qr && (
        <div className="card" style={{ marginBottom: 16, textAlign: 'center' }}>
          <img src={qr} alt="bunker QR" style={{ width: 180, height: 180 }} />
        </div>
      )}

      <p style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', marginBottom: 16 }}>
        Keep this screen open until your app connects.
      </p>

      {appName !== undefined ? (
        <div className="card" style={{ marginBottom: 16, textAlign: 'center' }}>
          <p style={{ color: 'var(--success, #22c55e)', fontWeight: 600, marginBottom: 12 }}>
            Connected to {appName}
          </p>
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: 8 }}
            onClick={onManageApps}
          >
            Manage connected apps
          </button>
          <button
            className="btn btn-ghost"
            style={{ width: '100%' }}
            onClick={onDone}
          >
            Done
          </button>
        </div>
      ) : (
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center' }}>
          Waiting for an app to connect…
        </p>
      )}
    </main>
  )
}
