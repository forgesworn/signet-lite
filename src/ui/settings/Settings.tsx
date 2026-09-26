import type { Theme } from '../theme.js'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function Settings({ theme, onSetTheme, explain, onToggleExplain, canUpgradeQuickUnlock, onUpgradeQuickUnlock, onBackup, onMoveToMySignet, onConnectedApps, onActivity, onRelays, onLock, onDeleteSignet, onBack }: {
  theme: Theme
  onSetTheme: (t: Theme) => void
  explain: boolean
  onToggleExplain: (next: boolean) => void
  canUpgradeQuickUnlock?: boolean
  onUpgradeQuickUnlock?: () => void
  onBackup: () => void
  onMoveToMySignet: () => void
  onConnectedApps: () => void
  onActivity: () => void
  onRelays: () => void
  onLock: () => void
  onDeleteSignet: () => void
  onBack: () => void
}) {
  return (
    <main className="page fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <button
          className="btn btn-ghost"
          aria-label="Back"
          style={{ width: 'auto', padding: '6px 10px', fontSize: 18 }}
          onClick={onBack}
        >
          ←
        </button>
        <h1 className="section-title" style={{ margin: 0 }}>Settings</h1>
      </div>

      {/* Theme toggle */}
      <section style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Appearance
        </p>
        <div className="card" style={{ padding: '4px', display: 'flex', gap: 4 }}>
          {THEMES.map(({ value, label }) => (
            <button
              key={value}
              style={{
                flex: 1,
                padding: '8px 0',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: theme === value ? 700 : 400,
                background: theme === value ? 'var(--accent)' : 'transparent',
                color: theme === value ? 'var(--on-accent)' : 'var(--text-primary)',
                transition: 'background 0.15s, color 0.15s',
              }}
              onClick={() => onSetTheme(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Helpful explanations toggle */}
      <section style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Guidance
        </p>
        <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>Show helpful explanations</p>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Friendly tips on each screen. Turn off once you've got the hang of it.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={explain}
            aria-label="Show helpful explanations"
            onClick={() => onToggleExplain(!explain)}
            style={{
              flexShrink: 0, width: 46, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer', padding: 3,
              background: explain ? 'var(--accent)' : 'var(--border)', transition: 'background 0.15s',
              display: 'flex', justifyContent: explain ? 'flex-end' : 'flex-start', alignItems: 'center',
            }}
          >
            <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', display: 'block' }} />
          </button>
        </div>
      </section>

      {canUpgradeQuickUnlock && onUpgradeQuickUnlock && (
        <section style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Security
          </p>
          <div className="card card-warning" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            Protect quick unlock with this device's secure hardware so a copied browser database cannot be tested against your 6-digit PIN alone.
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={onUpgradeQuickUnlock}>
              Secure quick unlock
            </button>
          </div>
        </section>
      )}

      {/* Nav rows */}
      <section style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Account
        </p>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {[
            { label: 'Backup phrase', onClick: onBackup },
            { label: 'Move to My Signet', onClick: onMoveToMySignet },
            { label: 'Connected apps', onClick: onConnectedApps },
            { label: 'Activity', onClick: onActivity },
            { label: 'Relays', onClick: onRelays },
          ].map(({ label, onClick }, i, arr) => (
            <button
              key={label}
              onClick={onClick}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '14px 16px',
                background: 'transparent',
                border: 'none',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                cursor: 'pointer',
                fontSize: 15,
                fontWeight: 500,
                color: 'var(--text-primary)',
                textAlign: 'left',
              }}
            >
              {label}
              <span style={{ color: 'var(--text-secondary)', fontSize: 18, lineHeight: 1 }}>›</span>
            </button>
          ))}
        </div>
      </section>

      {/* Lock */}
      <button className="btn btn-secondary" style={{ width: '100%', marginBottom: 32 }} onClick={onLock}>
        Lock now
      </button>

      {/* Danger zone */}
      <section>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Danger zone
        </p>
        <button
          className="btn btn-danger"
          style={{ width: '100%' }}
          onClick={onDeleteSignet}
        >
          Delete signet
        </button>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45, margin: '8px 2px 0' }}>
          Wipes everything on this device and starts setup over. You'll need your recovery phrase to restore it.
        </p>
      </section>
    </main>
  )
}
