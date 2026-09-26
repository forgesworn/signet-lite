/** Success confirmation shown after an app connects via a pasted nostrconnect link.
 *  (The bunker flow shows its own success card inside Bunker.tsx.) Offers a shortcut
 *  to the Connected apps screen so the user can name the app and set what it can do. */
export function ConnectDone({ appName, onManageApps, onDone }: {
  appName?: string
  onManageApps: () => void
  onDone: () => void
}) {
  return (
    <main className="page fade-in">
      <h2 className="section-title">Connect an app</h2>
      <div className="card" style={{ marginBottom: 16, textAlign: 'center' }}>
        <p style={{ color: 'var(--success, #22c55e)', fontWeight: 600, marginBottom: 12 }}>
          {appName ? `Connected to ${appName}` : 'Connected'}
        </p>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
          Name this app and choose what it's allowed to do in Connected apps.
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
    </main>
  )
}
