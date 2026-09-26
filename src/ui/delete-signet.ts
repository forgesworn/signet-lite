import type { Session } from '../app/session.js'
import { clearAll } from '../app/db.js'

/** Factory-reset this device: stop the live signer/relay (dropping in-memory key material),
 *  then wipe every stored record — encrypted master, identities, connected apps, prefs. After
 *  this the app has no master, so it returns to the welcome/setup flow. Irreversible: only the
 *  recovery phrase restores the identities. */
export async function deleteSignet(opts: { session: Session | null }): Promise<void> {
  opts.session?.lock()
  await clearAll()
}
