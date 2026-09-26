import type { ReactNode } from 'react'

/** A friendly explanatory note, shown only when "explain mode" is on (Settings → Show helpful
 *  explanations). Centralises the helper-text styling so every screen reads consistently and can
 *  hide it with a single flag once the user is comfortable. */
export function Hint({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null
  return <div className="hint" role="note">{children}</div>
}
