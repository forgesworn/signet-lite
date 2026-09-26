import { isValidRelayUrl } from '../engine/relay-url.js'
import { listApps, loadPrefs, type StoredApp } from '../app/db.js'

/** Append a relay if it is a valid wss URL and not already present. */
export function addRelay(relays: string[], url: string): { relays: string[]; error?: string } {
  const u = url.trim()
  if (!isValidRelayUrl(u)) return { relays, error: 'Enter a valid wss:// relay URL.' }
  if (relays.includes(u)) return { relays, error: 'That relay is already in the list.' }
  return { relays: [...relays, u] }
}

/** Remove a relay, but never empty the list (a signer needs at least one relay). */
export function removeRelay(relays: string[], url: string): string[] {
  if (relays.length <= 1) return relays
  return relays.filter(r => r !== url)
}

/** The relays the live signer listens on (M1): the user's list, then every relay a paired
 *  nostrconnect app asked for, de-duplicated. Without the app relays, a second pairing or any
 *  relay edit would silently stop the signer hearing an earlier app on its own relay. */
export function sessionRelays(userRelays: string[], apps: Pick<StoredApp, 'relays'>[]): string[] {
  // A stored app relay is re-checked before use: it persists across unlocks, so one malformed URL
  // must be dropped here rather than break every future session start.
  const appRelays = apps.flatMap(a => a.relays ?? []).filter(isUsableRelayUrl)
  return Array.from(new Set([...userRelays, ...appRelays]))
}

function isUsableRelayUrl(url: string): boolean {
  if (typeof url !== 'string' || !isValidRelayUrl(url)) return false
  try {
    const u = new URL(url)
    return (u.protocol === 'wss:' || u.protocol === 'ws:') && u.hostname !== ''
  } catch {
    return false
  }
}

/** sessionRelays from what is stored now; `userRelays` overrides the saved list (a pending edit). */
export async function loadSessionRelays(userRelays?: string[]): Promise<string[]> {
  const [prefs, apps] = await Promise.all([userRelays ? null : loadPrefs(), listApps()])
  return sessionRelays(userRelays ?? prefs!.relays, apps)
}
