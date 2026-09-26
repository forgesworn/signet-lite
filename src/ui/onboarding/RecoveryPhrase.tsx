export function RecoveryPhrase({ words, onContinue }: { words: string[]; onContinue: () => void }) {
  return (
    <main className="page">
      <h2 style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>Your recovery phrase</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
        Write these 12 words on paper and keep them safe. They're the only way to restore your identities — nobody can reset them for you.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 12 }}>
        {words.map((word, i) => (
          <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 9px', fontSize: 12.5, display: 'flex', gap: 7 }}>
            <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 14 }}>{i + 1}</span>
            <span style={{ fontWeight: 600 }}>{word}</span>
          </div>
        ))}
      </div>
      <div className="card card-warning" style={{ fontSize: 11.5, lineHeight: 1.45, marginBottom: 14 }}>
        ⚠ Never share these. Anyone who has them controls your identities.
      </div>
      <button className="btn btn-primary" onClick={onContinue}>I've written them down</button>
    </main>
  )
}
