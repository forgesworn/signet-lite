export function UpdateBanner({ show, onReload, onDismiss }: { show: boolean; onReload: () => void; onDismiss: () => void }) {
  if (!show) return null
  return (
    <div role="status" style={{ position: 'fixed', left: 12, right: 12, bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', zIndex: 50, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 'var(--radius)', background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
      <span style={{ flex: 1, fontSize: 13 }}>A new version is available.</span>
      <button className="btn btn-primary" style={{ width: 'auto', padding: '6px 12px', fontSize: 13 }} onClick={onReload}>Reload</button>
      <button className="btn btn-ghost" aria-label="Dismiss" style={{ width: 'auto', padding: '6px 8px', fontSize: 13 }} onClick={onDismiss}>✕</button>
    </div>
  )
}
