import { saveProfile, loadProfile } from '../../app/db.js'
import { fetchKind0Many } from './fetch-profile.js'

/** Fetch each identity's kind 0 and store it locally for Home to show. Updates metadata while
 *  preserving any locally-uploaded avatar blob, and leaves an identity untouched when it has no
 *  kind 0 (an empty fetch never clobbers a saved profile). Best-effort and side-effecting; the
 *  caller runs it in the background and re-reads the store when it resolves. */
export async function refreshProfiles(
  relays: string[],
  identities: { name: string; pubkeyHex: string }[],
  fetchMany: typeof fetchKind0Many = fetchKind0Many,
  now: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  const found = await fetchMany(relays, identities.map(i => i.pubkeyHex))
  for (const id of identities) {
    const profile = found.get(id.pubkeyHex)
    if (!profile) continue
    const existing = await loadProfile(id.name)
    await saveProfile({ name: id.name, metadata: profile.metadata, avatarBlob: existing?.avatarBlob, updatedAt: now })
  }
}
