import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface StoredMaster {
  /** encryptSecret(secret, masterKeyHex) — the root secret (a 12-word mnemonic or an imported nsec), encrypted once under the random master key. */
  ciphertext: string
  /** Whether the user has confirmed they wrote down their recovery phrase. */
  backedUp: boolean
  /** Whether the encrypted root secret is a 12-word mnemonic or an imported nsec. Absent ⇒ 'mnemonic'. */
  rootKind?: 'mnemonic' | 'nsec'
  /** Legacy/basic PIN-only wrap of the master key. Existing installs keep this until upgraded. */
  pin?: { wrapped: string }
  /** Strong quick-unlock wrap: WebAuthn PRF output + 6-digit PIN derive the wrapping key.
   *  Unlike `pin`, this cannot be brute-forced from an IndexedDB copy alone. */
  pinPrf?: {
    credentialId: string
    wrapped: string
    salt: string
  }
  /** Persisted PIN brute-force throttle: number of consecutive failures since last correct unlock. */
  pinFailures?: number
  /** Persisted PIN brute-force throttle: epoch ms at which the lockout expires (0 = not locked). */
  pinLockedUntil?: number
  /** Optional biometric wrap of the master key. Only PRF-backed wraps are accepted for unlock. */
  biometric?: {
    credentialId: string   // base64 WebAuthn rawId
    prf: boolean           // true = PRF-derived key; false = legacy unsupported fallback
    wrapped: string        // encryptWithKey(masterKeyHex, derivedKey)
    salt?: string          // legacy fallback records only; never written by current code
  }
}
export interface StoredIdentity {
  name: string
  npub: string
  pubkeyHex: string
  /** Only meaningful for an nsec master: 'root' is the raw nsec, 'derived' is a fromNsec child. */
  derivation?: 'root' | 'derived'
}
/** Whether an action category for an app is gated ('ask') or auto-signed ('always'). */
export type ActionPolicy = 'ask' | 'always'
/** Policy for writing the user's kind-0 profile. 'decline' rejects without a prompt. */
export type ProfilePolicy = 'decline' | 'ask' | 'always'
/** Per-category signing policy for a connected app. `profile` is optional on stored
 *  records; `appPolicies` fills it in. */
export interface AppPolicies { sign: ActionPolicy; dm: ActionPolicy; profile?: ProfilePolicy }
/** AppPolicies with a concrete profile value, as returned by `appPolicies`. */
export interface ResolvedPolicies { sign: ActionPolicy; dm: ActionPolicy; profile: ProfilePolicy }
export interface StoredApp {
  appKey?: string
  clientPubkey: string
  identityName: string
  appName: string
  appUrl?: string
  /** User-set display name; falls back to appName when unset. */
  label?: string
  /** Per-category signing policy. New records use this. */
  policies?: AppPolicies
  /** Per-kind overrides for sign_event (kind ≠ 0): a kind set here wins over the blanket `sign`
   *  policy; absence falls back to it. Keys are kind numbers as strings (JSON object keys). */
  kindPolicies?: Record<string, ActionPolicy>
  /** Relays a nostrconnect app asked to be reached on (from its pairing link). The signer listens
   *  on the user's relays ∪ every app's relays. Optional: absent on bunker-paired apps and on
   *  records written before this field existed — an additive value field, no store change. */
  relays?: string[]
  /** Legacy single policy — kept optional so pre-0.4 records still read; never written going forward. */
  policy?: 'ask' | 'always-allow'
  connectedAt: number
}
export interface StoredPrefs { theme: 'system' | 'light' | 'dark'; relays: string[]; explain: boolean; blossomServer: string }

// Only fresh installs pick these up — loadPrefs() lets a saved relay list win.
const DEFAULT_PREFS: StoredPrefs = { theme: 'system', relays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band', 'wss://relay.primal.net', 'wss://relay.nsec.app'], explain: true, blossomServer: 'https://blossom.band' }

/** kind-0 profile metadata fields (the JSON content of a kind-0 event). All optional. */
export interface ProfileMetadata {
  name?: string
  /** Read from a kind 0's display_name (or displayName) for presentation only. Not managed by
   *  the editor; carried through an edit by buildKind0Content's raw passthrough. */
  display_name?: string
  about?: string
  picture?: string
  website?: string
  nip05?: string
  lud16?: string
}
/** A per-identity profile: the kind-0 metadata plus a local copy of the avatar image. */
export interface StoredProfile {
  name: string            // identity name (the store key)
  metadata: ProfileMetadata
  avatarBlob?: Blob       // local copy of the uploaded avatar (the "stored locally" requirement)
  updatedAt: number
}

/** The outcome of a handled NIP-46 request, as recorded in the activity log. */
export type ActivityOutcome = 'signed' | 'denied' | 'error'

/** One activity-log line. Metadata only: NO decrypted content, NO plaintext, and — crucially
 *  — NO DM counterparty pubkey (logging who you message would build a social graph at rest). */
export interface ActivityEntry {
  /** autoIncrement key, assigned by IndexedDB. */
  id?: number
  /** Epoch seconds when the request was handled. */
  ts: number
  identityName: string
  clientPubkey: string
  method: string
  /** Present only for sign_event — useful and non-sensitive. */
  kind?: number
  outcome: ActivityOutcome
  /** Auto-approved by an always-policy without prompting. Optional: absent on older rows. */
  auto?: boolean
  /** The app's auto-approval budget was exceeded, so this request was forced to a prompt. */
  rateLimited?: boolean
  /** A 'denied' that happened because the prompt went unanswered until it timed out, rather than an
   *  explicit refusal. Optional: absent on older rows and on every non-timeout outcome. */
  timedOut?: boolean
  /** Present only when outcome is 'error': a short, protocol-level reason ("invalid event
   *  template", "unsupported method"). Never plaintext or content — just why the request failed. */
  errorCode?: string
  /** The app's display name captured at log time, so history stays readable after the app is
   *  forgotten or renamed. Optional: absent on older rows (the reader falls back to a live lookup). */
  appName?: string
}

/** Activity log is bounded so it never grows without limit in IndexedDB. */
export const ACTIVITY_MAX = 500
export const ACTIVITY_TTL_SECONDS = 90 * 24 * 60 * 60
export const HANDLED_REQUEST_MAX = 4096
export const HANDLED_REQUEST_TTL_SECONDS = 15 * 60

export interface StoredHandledRequest {
  id: string
  seenAt: number
}

interface Schema extends DBSchema {
  master: { key: string; value: StoredMaster }
  identities: { key: string; value: StoredIdentity }
  /** Legacy pre-v3 app store, keyed only by clientPubkey. Kept only for migration reads. */
  apps: { key: string; value: StoredApp }
  appAccess: { key: string; value: StoredApp }
  prefs: { key: string; value: StoredPrefs }
  profiles: { key: string; value: StoredProfile }
  activity: { key: number; value: ActivityEntry }
  handledRequests: { key: string; value: StoredHandledRequest }
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null
function db() {
  if (!dbp) dbp = openDB<Schema>('signet-lite', 5, {
    upgrade(d, oldVersion) {
      // Fresh install (oldVersion 0) creates everything. Existing installs keep
      // the legacy `apps` store and gain `appAccess`, keyed by identity+client.
      if (oldVersion < 1) {
        d.createObjectStore('master')
        d.createObjectStore('identities', { keyPath: 'name' })
        d.createObjectStore('apps', { keyPath: 'clientPubkey' })
        d.createObjectStore('prefs')
      }
      if (oldVersion < 2) {
        d.createObjectStore('profiles', { keyPath: 'name' })
      }
      if (oldVersion < 3) {
        d.createObjectStore('appAccess', { keyPath: 'appKey' })
      }
      if (oldVersion < 4) {
        d.createObjectStore('activity', { keyPath: 'id', autoIncrement: true })
      }
      if (oldVersion < 5) {
        d.createObjectStore('handledRequests', { keyPath: 'id' })
      }
    },
  })
  return dbp
}

export async function saveMaster(m: StoredMaster) { await (await db()).put('master', m, 'master') }
export async function loadMaster() { return (await db()).get('master', 'master') }

/** Atomic read-modify-write of the master record: `fn` sees the CURRENT stored value inside one
 *  readwrite transaction, so concurrent writers (another tab's PIN attempt, markBackedUp, an
 *  upgrade) can't lose each other's changes. Return null from `fn` to leave the record untouched.
 *  `fn` must be synchronous — no awaiting non-IDB work inside an IDB transaction. Resolves to the
 *  record as written (or the untouched current value / undefined when there is none). */
export async function updateMaster(fn: (current: StoredMaster) => StoredMaster | null): Promise<StoredMaster | undefined> {
  const tx = (await db()).transaction('master', 'readwrite')
  const current = await tx.store.get('master')
  let result = current
  if (current) {
    const next = fn(current)
    if (next) { await tx.store.put(next, 'master'); result = next }
  }
  await tx.done
  return result
}

export async function addIdentityRecord(i: StoredIdentity) { await (await db()).put('identities', i) }
export async function removeIdentityRecord(name: string) { await (await db()).delete('identities', name) }
export async function listIdentities() { return (await db()).getAll('identities') }

export function makeAppKey(identityName: string, clientPubkey: string): string {
  return `${clientPubkey}:${encodeURIComponent(identityName)}`
}

function withAppKey(a: StoredApp): StoredApp {
  return { ...a, appKey: makeAppKey(a.identityName, a.clientPubkey) }
}

/** Copy legacy client-keyed app records into the identity-scoped store on first access. */
async function migrateLegacyApps(): Promise<void> {
  const d = await db()
  const legacy = await d.getAll('apps')
  if (legacy.length === 0) return
  const tx = d.transaction(['apps', 'appAccess'], 'readwrite')
  const appAccess = tx.objectStore('appAccess')
  const apps = tx.objectStore('apps')
  const writes = legacy.flatMap(app => [
    appAccess.put(withAppKey(app)),
    apps.delete(app.clientPubkey),
  ])
  await Promise.all(writes)
  await tx.done
}

export async function putApp(a: StoredApp) {
  await migrateLegacyApps()
  await (await db()).put('appAccess', withAppKey(a))
}
export async function getApp(identityName: string, clientPubkey: string) {
  await migrateLegacyApps()
  return (await db()).get('appAccess', makeAppKey(identityName, clientPubkey))
}
export async function removeApp(identityName: string, clientPubkey: string) {
  await migrateLegacyApps()
  await (await db()).delete('appAccess', makeAppKey(identityName, clientPubkey))
}
export async function listApps() {
  await migrateLegacyApps()
  return (await db()).getAll('appAccess')
}

/** Resolve an app's per-category policy, tolerating legacy single-policy records and
 *  defaulting profile (kind 0) writes to 'decline'. */
export function appPolicies(app: Pick<StoredApp, 'policies' | 'policy'>): ResolvedPolicies {
  if (app.policies) return { sign: app.policies.sign, dm: app.policies.dm, profile: app.policies.profile ?? 'decline' }
  const v: ActionPolicy = app.policy === 'always-allow' ? 'always' : 'ask'
  return { sign: v, dm: v, profile: 'decline' }
}

/** Display name for a connected app: the user's label if set, else the original app name. */
export function appDisplayName(app: Pick<StoredApp, 'label' | 'appName'>): string {
  return app.label?.trim() || app.appName
}

/** Set (or clear, when blank) the user's display label for a connected app. */
export async function renameApp(identityName: string, clientPubkey: string, label: string): Promise<void> {
  const a = await getApp(identityName, clientPubkey)
  if (!a) return
  const trimmed = label.trim()
  await putApp({ ...a, label: trimmed || undefined })
}

/** Set one category's policy for a connected app, migrating off the legacy field. */
export async function setAppPolicy(identityName: string, clientPubkey: string, category: keyof AppPolicies, value: ActionPolicy | ProfilePolicy): Promise<void> {
  const a = await getApp(identityName, clientPubkey)
  if (!a) return
  const policies: AppPolicies = { ...appPolicies(a), [category]: value } as AppPolicies
  const { policy: _legacy, appKey: _oldKey, ...rest } = a
  await putApp({ ...rest, policies })
}

/** Set (or, with `null`, remove) a per-kind sign_event override for a connected app. Removing
 *  resets that kind to the blanket `sign` policy. Drops the legacy field, like setAppPolicy. */
export async function setAppKindPolicy(identityName: string, clientPubkey: string, kind: number, value: ActionPolicy | null): Promise<void> {
  const a = await getApp(identityName, clientPubkey)
  if (!a) return
  const kindPolicies: Record<string, ActionPolicy> = { ...a.kindPolicies }
  if (value === null) delete kindPolicies[String(kind)]
  else kindPolicies[String(kind)] = value
  const { policy: _legacy, appKey: _oldKey, ...rest } = a
  await putApp({ ...rest, kindPolicies })
}

export async function loadPrefs(): Promise<StoredPrefs> {
  const stored = await (await db()).get('prefs', 'prefs')
  return { ...DEFAULT_PREFS, ...stored }
}
export async function savePrefs(p: StoredPrefs) { await (await db()).put('prefs', p, 'prefs') }

export async function saveProfile(p: StoredProfile) { await (await db()).put('profiles', p) }
export async function loadProfile(name: string) { return (await db()).get('profiles', name) }
export async function listProfiles() { return (await db()).getAll('profiles') }
export async function removeProfile(name: string) { await (await db()).delete('profiles', name) }

/** Append one activity-log line, then prune: drop anything older than the TTL and cap the
 *  store to `max` newest entries. `entry.ts` is treated as "now" for the TTL cutoff, so the
 *  log self-bounds without db.ts needing a clock. Bounds are overridable for tests. */
export async function appendActivity(
  entry: Omit<ActivityEntry, 'id'>,
  bounds: { max?: number; ttlSeconds?: number } = {},
): Promise<void> {
  const max = bounds.max ?? ACTIVITY_MAX
  const ttlSeconds = bounds.ttlSeconds ?? ACTIVITY_TTL_SECONDS
  const cutoff = entry.ts - ttlSeconds
  const d = await db()
  const tx = d.transaction('activity', 'readwrite')
  const store = tx.store
  await store.add(entry as ActivityEntry)
  // Drop entries older than the TTL (cursor is ordered by ascending id ≈ insertion order).
  let total = 0
  for (let c = await store.openCursor(); c; c = await c.continue()) {
    if (c.value.ts < cutoff) await c.delete()
    else total++
  }
  // Cap to `max` newest: delete the oldest (lowest-id) surviving rows.
  let toDrop = total - max
  if (toDrop > 0) {
    for (let c = await store.openCursor(); c && toDrop > 0; c = await c.continue()) {
      await c.delete()
      toDrop--
    }
  }
  await tx.done
}

/** Read activity newest-first, optionally filtered to one app and/or identity. */
export async function listActivity(opts: { identityName?: string; clientPubkey?: string; limit?: number } = {}): Promise<ActivityEntry[]> {
  const all = await (await db()).getAll('activity')
  const filtered = all.filter(e =>
    (opts.identityName === undefined || e.identityName === opts.identityName) &&
    (opts.clientPubkey === undefined || e.clientPubkey === opts.clientPubkey),
  )
  filtered.sort((a, b) => b.ts - a.ts || (b.id ?? 0) - (a.id ?? 0))
  return opts.limit === undefined ? filtered : filtered.slice(0, opts.limit)
}

/** Clear the activity log — all of it, or just the rows matching a filter. */
export async function clearActivity(filter?: { identityName?: string; clientPubkey?: string }): Promise<void> {
  const d = await db()
  if (!filter || (filter.identityName === undefined && filter.clientPubkey === undefined)) {
    await d.clear('activity')
    return
  }
  const tx = d.transaction('activity', 'readwrite')
  for (let c = await tx.store.openCursor(); c; c = await c.continue()) {
    const match =
      (filter.identityName === undefined || c.value.identityName === filter.identityName) &&
      (filter.clientPubkey === undefined || c.value.clientPubkey === filter.clientPubkey)
    if (match) await c.delete()
  }
  await tx.done
}

/** Persist a handled request event id before signing. Returns true when the id is already recent. */
export async function rememberHandledRequest(
  id: string,
  seenAt: number = Math.floor(Date.now() / 1000),
  bounds: { max?: number; ttlSeconds?: number } = {},
): Promise<boolean> {
  const max = bounds.max ?? HANDLED_REQUEST_MAX
  const ttlSeconds = bounds.ttlSeconds ?? HANDLED_REQUEST_TTL_SECONDS
  const cutoff = seenAt - ttlSeconds
  const d = await db()
  const tx = d.transaction('handledRequests', 'readwrite')
  const store = tx.store
  const existing = await store.get(id)
  const alreadyRecent = existing !== undefined && existing.seenAt >= cutoff
  await store.put({ id, seenAt })

  const rows = await store.getAll()
  const survivors: StoredHandledRequest[] = []
  const deletes: Promise<void>[] = []
  for (const row of rows) {
    if (row.seenAt < cutoff) deletes.push(store.delete(row.id))
    else survivors.push(row)
  }
  survivors.sort((a, b) => a.seenAt - b.seenAt)
  for (const row of survivors.slice(0, Math.max(0, survivors.length - max))) {
    deletes.push(store.delete(row.id))
  }
  await Promise.all(deletes)
  await tx.done
  return alreadyRecent
}

/** Check a handled request id without inserting a new row. Expired ids are treated as unseen. */
export async function hasHandledRequest(
  id: string,
  seenAt: number = Math.floor(Date.now() / 1000),
  bounds: { ttlSeconds?: number } = {},
): Promise<boolean> {
  const ttlSeconds = bounds.ttlSeconds ?? HANDLED_REQUEST_TTL_SECONDS
  const cutoff = seenAt - ttlSeconds
  const existing = await (await db()).get('handledRequests', id)
  return existing !== undefined && existing.seenAt >= cutoff
}

/** Wipe every store — used for logout / factory-reset / start-over. With `replacementMaster`,
 *  the new master record is written in the SAME transaction as the wipe, so a restore-over-an-
 *  existing-signet either fully happens or not at all: a crash can never leave the previous
 *  owner's identities/apps/activity sitting next to a new key. */
export async function clearAll(opts: { replacementMaster?: StoredMaster } = {}): Promise<void> {
  const d = await db()
  const tx = d.transaction(['master', 'identities', 'apps', 'appAccess', 'prefs', 'profiles', 'activity', 'handledRequests'], 'readwrite')
  await Promise.all([
    tx.objectStore('master').clear(),
    tx.objectStore('identities').clear(),
    tx.objectStore('apps').clear(),
    tx.objectStore('appAccess').clear(),
    tx.objectStore('prefs').clear(),
    tx.objectStore('profiles').clear(),
    tx.objectStore('activity').clear(),
    tx.objectStore('handledRequests').clear(),
  ])
  if (opts.replacementMaster) await tx.objectStore('master').put(opts.replacementMaster, 'master')
  await tx.done
}

/** Test-only: close the cached connection so deleteDB can proceed without blocking. */
export async function __resetDbForTests() {
  if (dbp) {
    const conn = await dbp
    conn.close()
    dbp = null
  }
}
