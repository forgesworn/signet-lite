import { Brand } from '../components/Brand'

export function Welcome({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <main className="page">
      <Brand />
      <p className="section-title" style={{ textAlign: 'center', margin: '8px 24px 28px', textTransform: 'none' }}>
        Your keys, your identities — held only on your phone.
      </p>
      <button className="btn btn-primary" onClick={onCreate}>Create a new identity</button>
      <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onImport}>I already have a backup</button>
    </main>
  )
}
