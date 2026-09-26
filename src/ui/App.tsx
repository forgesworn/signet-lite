import { useEffect, useState, useRef, useCallback } from 'react'
import type { Session } from '../app/session.js'
import type { ApprovalRequest, ActivityEvent, ApprovalDecision } from '../engine/signer.js'
import { loadMaster, listIdentities, addIdentityRecord, getApp, putApp, loadPrefs, savePrefs, listApps, appPolicies, appDisplayName, renameApp, setAppPolicy, setAppKindPolicy, loadProfile, listProfiles, makeAppKey, appendActivity, listActivity, clearActivity } from '../app/db.js'
import type { StoredApp, AppPolicies, ActionPolicy, ProfilePolicy, ProfileMetadata } from '../app/db.js'
import { createRateLimiter, type RateLimiter } from './rate-limit.js'
import { createApprovalQueue, type PendingApproval, type ApprovalQueue } from './approval-queue.js'
import { buildBunkerUri } from './bunker-uri.js'
import { setupWithPin, setupWithPinPrf, upgradePinToPinPrf, isBiometricAvailable, unlockWithPin, markBackedUp } from '../app/auth.js'
import { generateMnemonic } from '../engine/mnemonic.js'
import { deriveIdentity } from '../engine/derive.js'
import { identityFromNsec } from '../engine/nsec.js'
import { decideInitialScreen, type Screen } from './screen.js'
import { unlockSession } from './unlock-session.js'
import { pickConfirmIndices } from './onboarding/confirm.js'
import { resolveApproval, appRecordFromRequest, categoryForRequest } from './approval-policy.js'
import { connectApp } from './connect-app.js'
import { deleteSignet } from './delete-signet.js'
import { addIdentityLive } from './add-identity.js'
import { removeIdentityLive } from './remove-identity.js'
import { revokeApp } from './revoke-app.js'
import { addRelay, removeRelay, loadSessionRelays } from './relays-edit.js'
import { setTheme as persistTheme, type Theme } from './theme.js'
import { createWakeLockController, browserWakeLockIO, type WakeLockController } from '../app/wake-lock.js'
import { createSessionAutoLock, browserAutoLockIO } from '../app/auto-lock.js'
import { Welcome } from './onboarding/Welcome'
import { Import } from './onboarding/Import'
import { RecoveryPhrase } from './onboarding/RecoveryPhrase'
import { ConfirmBackup } from './onboarding/ConfirmBackup'
import { SetupUnlock } from './onboarding/SetupUnlock'
import { Unlock } from './unlock/Unlock'
import { RestoreWarning } from './unlock/RestoreWarning'
import { Brand } from './components/Brand'
import { PinPad } from './components/PinPad'
import { Home } from './Home'
import { Connect } from './connect/Connect'
import { Bunker } from './connect/Bunker'
import { ConnectDone } from './connect/ConnectDone'
import { ApproveSign } from './approve/ApproveSign'
import { Profile } from './profile/Profile'
import { publishProfile } from './profile/save-profile.js'
import { fetchKind0 } from './profile/fetch-profile.js'
import { refreshProfiles } from './profile/refresh-profiles.js'
import { normaliseBlossomServer } from '../app/blossom.js'
import { Settings } from './settings/Settings'
import { DeleteSignet } from './settings/DeleteSignet'
import { Backup } from './settings/Backup'
import { MoveToMySignet } from './settings/MoveToMySignet'
import { ConnectedApps } from './settings/ConnectedApps'
import { Relays } from './settings/Relays'
import { Activity, type ActivityRow } from './settings/Activity'
import { activityAppName } from './settings/activity-format.js'

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [bootSlow, setBootSlow] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [identities, setIdentities] = useState<{ name: string; npub: string }[]>([])
  // The nsec master's root identity name (cannot be deleted). null for mnemonic masters.
  const [rootIdentityName, setRootIdentityName] = useState<string | null>(null)
  const [activeTheme, setActiveTheme] = useState<Theme>('system')
  // Explain mode: friendly on-screen helper text, on by default, toggleable in Settings.
  const [explain, setExplain] = useState(true)

  // Onboarding state — mnemonic + identity name shared across create and import flows
  const [mnemonic, setMnemonic] = useState<string | null>(null)
  const [identityName, setIdentityName] = useState('default')
  // Onboarding root kind: 'mnemonic' for create/words-restore, 'nsec' for an imported key.
  const [rootKind, setRootKind] = useState<'mnemonic' | 'nsec'>('mnemonic')
  const [picks, setPicks] = useState<number[]>([])
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  // Whether the user has chosen Face ID (needs a backup PIN collected separately)
  const [setupMode, setSetupMode] = useState<'none' | 'biometric-needs-pin'>('none')
  const [setupError, setSetupError] = useState('')
  const [canUpgradeQuickUnlock, setCanUpgradeQuickUnlock] = useState(false)
  const [quickUnlockError, setQuickUnlockError] = useState('')
  const [busy, setBusy] = useState(false)
  // H1: set once the user confirmed "erase everything and restore" from the Unlock screen. The
  // next master write then wipes every store in the same transaction (a full reset, not a key swap).
  const [restoreReplacing, setRestoreReplacing] = useState(false)

  // Connected apps + relays editor state
  const [apps, setApps] = useState<StoredApp[]>([])
  const [relays, setRelays] = useState<string[]>([])
  const [relayError, setRelayError] = useState('')
  const [blossomServer, setBlossomServer] = useState('https://blossom.band')
  const [blossomError, setBlossomError] = useState('')

  // Activity log view state: the rows being shown, and (when set) the single app being scoped to.
  const [activityRows, setActivityRows] = useState<ActivityRow[]>([])
  const [activityScope, setActivityScope] = useState<{ identityName: string; clientPubkey: string; appName: string } | null>(null)

  // Per-identity presentation pulled from kind 0: avatar source (blob URL or the picture URL)
  // and display name. The identity record's name is never changed.
  const [profileData, setProfileData] = useState<Record<string, { avatarUrl?: string; displayName?: string }>>({})

  // Profile editor state
  const [profileName, setProfileName] = useState('')
  const [profileMeta, setProfileMeta] = useState<ProfileMetadata>({})
  const [profileBase, setProfileBase] = useState<Record<string, unknown>>({})
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | undefined>(undefined)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')

  // Per-app auto-sign rate limiter — one instance for the app's lifetime (survives lock/unlock,
  // like a continuous abuse window). Lazily created so it isn't rebuilt on every render.
  const rateLimiterRef = useRef<RateLimiter | null>(null)

  // Pending approval queue — a pure controller (clock injected) held in a ref so the instance
  // captured at unlock survives the session; `pending` mirrors its head for rendering. An
  // unanswered prompt times out to a clean decline instead of hanging the queue forever.
  const approvalQueueRef = useRef<ApprovalQueue | null>(null)
  // Request ids with a decision in flight (the "always allow" save awaits the DB), so a second tap
  // for the same request is ignored.
  const decidingRef = useRef<Set<number>>(new Set())
  const [pending, setPending] = useState<PendingApproval | null>(null)
  const [connectError, setConnectError] = useState<string>('')

  // Bunker mode state
  const [bunkerUri, setBunkerUri] = useState('')
  const [bunkerIdentity, setBunkerIdentity] = useState<string | null>(null)
  const [justConnected, setJustConnected] = useState<string | null>(null)

  // Screen wake lock: held while unlocked with at least one connected app, so a remote
  // signer request can reach us instead of timing out when the phone would otherwise dim.
  const [connectedCount, setConnectedCount] = useState(0)
  const [wakeLockSupported] = useState(() => browserWakeLockIO().isSupported())
  const wakeLockRef = useRef<WakeLockController | null>(null)
  const autoLockRef = useRef<ReturnType<typeof createSessionAutoLock> | null>(null)
  // Mirrors `session` so the once-captured lock() always clears the current session, including the
  // auto-lock path whose captured callback would otherwise see the stale first-render session.
  const sessionRef = useRef<Session | null>(null)
  // Bumped synchronously by lock()/doDeleteSignet — never by a render effect, so it's already
  // current the instant a teardown starts. `approve` (L1) re-checks it after its only await so a
  // request whose app lookup resolves after the session was torn down is denied without ever
  // enqueueing a prompt on a locked app.
  const sessionEpochRef = useRef(0)
  // Set synchronously at the very start of doDeleteSignet, before deleteSignet()/session.lock()
  // run — so handleActivity (L5) already sees it once a lock-time denial can fire onActivity.
  const deletingRef = useRef(false)
  // Whether a master is currently known to be stored in IndexedDB, kept from boot/setup/delete —
  // never inferred from `screen`, which can be transiently stale (L1). The final route below uses
  // this instead of always falling to Welcome, whose Create/Import would wipe an existing signet.
  const [masterExists, setMasterExists] = useState(false)

  useEffect(() => {
    let cancelled = false
    const slowTimer = setTimeout(() => {
      if (!cancelled) setBootSlow(true)
    }, 3000)
    void (async () => {
      const [master, prefs] = await Promise.all([loadMaster(), loadPrefs()])
      if (cancelled) return
      setActiveTheme(prefs.theme)
      setExplain(prefs.explain)
      const nextScreen = decideInitialScreen(!!master)
      setScreen(nextScreen)
      setMasterExists(!!master)
      if (nextScreen === 'unlock') {
        void isBiometricAvailable().then(avail => {
          if (!cancelled) setBiometricAvailable(avail)
        }, () => {})
      }
      clearTimeout(slowTimer)
    })().catch(() => {
      if (!cancelled) setBootSlow(true)
    })
    return () => {
      cancelled = true
      clearTimeout(slowTimer)
    }
  }, [])

  // One wake-lock controller for the app's lifetime.
  useEffect(() => {
    wakeLockRef.current = createWakeLockController(browserWakeLockIO())
    return () => { wakeLockRef.current?.dispose(); wakeLockRef.current = null }
  }, [])
  // Hold the screen awake only while unlocked AND at least one app is connected.
  useEffect(() => {
    sessionRef.current = session
    wakeLockRef.current?.setActive(session !== null && connectedCount > 0)
  }, [session, connectedCount])

  // Auto-lock is per session (H3): this holder is armed in enterWithMasterKey — so the idle clock
  // and hard cap start at unlock — and disarmed by lock()/reset. Nothing is armed during onboarding
  // or on the unlock screen. lock() is captured once here, but it clears the live session via
  // sessionRef, so an auto-triggered lock still clears the current keys.
  useEffect(() => {
    autoLockRef.current = createSessionAutoLock(browserAutoLockIO(lock))
    return () => { autoLockRef.current?.disarm(); autoLockRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Notify the auto-lock controller of user activity while the session is open.
  useEffect(() => {
    if (session === null) return
    const noteActivity = () => { autoLockRef.current?.noteActivity() }
    window.addEventListener('pointerdown', noteActivity)
    window.addEventListener('keydown', noteActivity)
    return () => {
      window.removeEventListener('pointerdown', noteActivity)
      window.removeEventListener('keydown', noteActivity)
    }
  }, [session])

  /** Recompute how many client apps are connected (drives the wake lock). */
  async function refreshConnectedCount() {
    setConnectedCount((await listApps()).length)
  }

  // Append one engine activity event to the on-device log. Stable (module fn + Date.now only),
  // so the instance captured at unlock stays correct for the whole session.
  const handleActivity = useCallback((e: ActivityEvent) => {
    // A handled signing request counts as activity — keeps an actively-used bunker session alive
    // (you sign from the client app) instead of locking on a hidden-page timer.
    autoLockRef.current?.noteActivity()
    // Snapshot the app's display name now, so the entry stays readable even after the app is
    // later forgotten or renamed (the reader falls back to a live lookup for older rows).
    void (async () => {
      // L5: deleteSignet's session.lock() settles any pending approval synchronously, which fires
      // this for the lock-time denial BEFORE clearAll()'s own await resolves. Its two-step write
      // (getApp then appendActivity) would otherwise land after the wipe, leaving a stray row in
      // the reset db. deletingRef is set before deleteSignet() is even called, so it's already
      // true here whenever this race is possible.
      if (deletingRef.current) return
      const app = await getApp(e.identityName, e.clientPubkey)
      if (deletingRef.current) return
      await appendActivity({ ts: Math.floor(Date.now() / 1000), ...e, appName: app ? appDisplayName(app) : undefined })
    })()
  }, [])

  // Lazily build the approval queue and wire its head changes to the prompt UI. One instance for
  // the session lifetime (like the rate limiter), so the reference captured at unlock stays valid
  // across lock/unlock. setPending/setScreen are stable, so the captured IO never goes stale.
  function approvalQueue(): ApprovalQueue {
    return (approvalQueueRef.current ??= createApprovalQueue({
      setTimer: (cb, ms) => window.setTimeout(cb, ms),
      clearTimer: id => window.clearTimeout(id),
      onHead: (item) => {
        setPending(item)
        // Show the prompt when one is waiting; when the last clears (decided or timed out) drop to
        // Home — but only FROM the approve screen, so a lock/reset teardown isn't disturbed.
        if (item) setScreen('approve')
        else setScreen(s => (s === 'approve' ? 'home' : s))
      },
    }))
  }

  // Real per-app policy approve hook — uses ONLY refs + stable setters so the instance
  // captured at unlock remains correct for the entire session lifetime. Returns the rich
  // ApprovalDecision so the activity log can show how the decision was reached.
  const approve = useCallback(async (req: ApprovalRequest): Promise<ApprovalDecision> => {
    const epoch = sessionEpochRef.current
    const app = await getApp(req.identityName, req.clientPubkey)
    // L1: lock()/delete landed while the app lookup was in flight — the session behind this
    // request is already gone. Deny without ever enqueueing a prompt on a locked app.
    if (sessionEpochRef.current !== epoch) return { ok: false, auto: true, rateLimited: false }
    let decision = resolveApproval(app, req.method, req.eventDetails?.kind)
    // Bound silent auto-signing: an over-budget always-app is downgraded to a prompt (never
    // hard-blocked), so a runaway or compromised app hits friction and the user stays in control.
    let rateLimited = false
    if (decision === 'allow') {
      const rl = (rateLimiterRef.current ??= createRateLimiter())
      const appKey = makeAppKey(req.identityName, req.clientPubkey)
      const now = Date.now()
      if (rl.overBudget(appKey, now)) { decision = 'ask'; rateLimited = true }
      else rl.record(appKey, now)
    }
    if (decision === 'allow') return { ok: true, auto: true, rateLimited: false }
    if (decision === 'decline') return { ok: false, auto: true, rateLimited: false }
    // One label source everywhere (L2): the user's label if set, else the app's own name.
    const appName = app ? appDisplayName(app) : `App ${req.clientPubkey.slice(0, 8)}`
    return approvalQueue().enqueue({ req, rateLimited, appName })
  }, [])

  // Stable bunker onConnect callback — uses only refs + stable setters so the instance
  // captured at unlock remains correct for the entire session lifetime.
  const handleBunkerConnect = useCallback(async (identityName: string, clientPubkey: string) => {
    // A client re-linking via a fresh bunker link may already have a stored record (e.g. it kept
    // its key). Preserve the user's name/policies and just refresh connectedAt rather than
    // clobbering them with defaults; only a genuinely new client gets the default record.
    const existing = await getApp(identityName, clientPubkey)
    const now = Math.floor(Date.now() / 1000)
    if (existing) {
      await putApp({ ...existing, connectedAt: now })
    } else {
      await putApp({ clientPubkey, identityName, appName: `App ${clientPubkey.slice(0, 8)}`, policies: { sign: 'ask', dm: 'ask', profile: 'ask' }, connectedAt: now })
    }
    setConnectedCount((await listApps()).length)
    setJustConnected(existing ? appDisplayName(existing) : `App ${clientPubkey.slice(0, 8)}`)
    setIdentities((await listIdentities()).map(i => ({ name: i.name, npub: i.npub })))
  }, [])

  /** Open a session from an unwrapped master key and go Home. Throws on failure (M3) after
   *  tearing down anything half-opened, so the caller (Unlock / setup) can show an error and let
   *  the user retry instead of hanging with a live signer behind a locked screen. */
  async function enterWithMasterKey(masterKey: string) {
    deletingRef.current = false // L5: a fresh session's activity events are never suppressed
    const { session, rootKind: rk } = await unlockSession(masterKey, { approve, onConnect: handleBunkerConnect, onActivity: handleActivity })
    let stored: Awaited<ReturnType<typeof listIdentities>>
    try {
      sessionRef.current = session
      setSession(session)
      autoLockRef.current?.arm()
      stored = await listIdentities()
      setIdentities(stored.map(i => ({ name: i.name, npub: i.npub })))
      setRootIdentityName(rk === 'nsec' ? (stored.find(i => i.derivation === 'root')?.name ?? null) : null)
      await loadProfileData()
      await refreshConnectedCount()
    } catch (err) {
      autoLockRef.current?.disarm()
      approvalQueueRef.current?.clear()
      session.lock()
      sessionRef.current = null
      setSession(null)
      setIdentities([])
      throw err
    }
    setScreen('home')
    // Pull fresh kind 0 for every identity without blocking Home, then repaint. Best-effort: a
    // relay failure must not surface as an unhandled rejection, so swallow it.
    const prefs = await loadPrefs()
    void refreshProfiles(prefs.relays, stored.map(i => ({ name: i.name, pubkeyHex: i.pubkeyHex })))
      .then(loadProfileData, () => {})
  }

  /** Read local profiles once and build, per identity name, the avatar source (object URL of the
   *  stored blob if present, else the kind 0 picture URL) and the display name. Revokes any
   *  blob: URLs held in the previous map to prevent object-URL leaks. */
  async function loadProfileData() {
    const profiles = await listProfiles()
    const map: Record<string, { avatarUrl?: string; displayName?: string }> = {}
    for (const p of profiles) {
      const avatarUrl = p.avatarBlob ? URL.createObjectURL(p.avatarBlob) : p.metadata.picture
      map[p.name] = { avatarUrl, displayName: p.metadata.display_name ?? p.metadata.name }
    }
    setProfileData(prev => {
      for (const v of Object.values(prev)) {
        if (v.avatarUrl?.startsWith('blob:')) URL.revokeObjectURL(v.avatarUrl)
      }
      return map
    })
  }

  function lock() {
    autoLockRef.current?.disarm()
    // L1: bump first — any `approve()` still awaiting its app lookup re-checks this and denies
    // instead of enqueueing once it resumes.
    sessionEpochRef.current++
    // Settle any in-flight approval as denied so no suspended sign frame retains key material.
    approvalQueueRef.current?.clear()
    sessionRef.current?.lock()
    setSession(null)
    setIdentities([])
    setProfileData(prev => {
      for (const v of Object.values(prev)) {
        if (v.avatarUrl?.startsWith('blob:')) URL.revokeObjectURL(v.avatarUrl)
      }
      return {}
    })
    setMnemonic(null)
    setBunkerIdentity(null)
    setScreen('unlock')
  }

  async function enterSettings() {
    const master = await loadMaster()
    setCanUpgradeQuickUnlock(biometricAvailable && !!master?.pin && !master.pinPrf && !!master.backedUp)
    setQuickUnlockError('')
    setScreen('settings')
  }

  /** Irreversible factory-reset: settle any in-flight approval (so no suspended sign frame keeps
   *  key material), stop the signer, wipe every stored record, then drop all derived UI state and
   *  return to the welcome/setup flow. */
  async function doDeleteSignet() {
    // L5: set before anything else — before session.lock() ever runs — so a lock-time denial's
    // onActivity (fired synchronously inside it) never writes a stray row after the wipe.
    deletingRef.current = true
    autoLockRef.current?.disarm()
    sessionEpochRef.current++ // L1: same guard as lock() — no stray approve() lands after this
    approvalQueueRef.current?.clear()
    await deleteSignet({ session })
    resetDeviceState()
    setMnemonic(null)
    setSetupMode('none')
    setSetupError('')
    setMasterExists(false)
    setScreen('welcome')
  }

  /** Drop every piece of in-memory state derived from the stored signet — after Delete signet,
   *  or once a restore-from-Unlock has replaced it (H1), so nothing of the old one lingers. */
  function resetDeviceState() {
    setRestoreReplacing(false)
    setSession(null)
    setIdentities([])
    setRootIdentityName(null)
    setProfileData(prev => {
      for (const v of Object.values(prev)) {
        if (v.avatarUrl?.startsWith('blob:')) URL.revokeObjectURL(v.avatarUrl)
      }
      return {}
    })
    setApps([])
    setConnectedCount(0)
    setRelays([])
    setBunkerUri('')
    setBunkerIdentity(null)
    setJustConnected(null)
    setConnectError('')
    setRelayError('')
    setBlossomError('')
    setCanUpgradeQuickUnlock(false)
    setQuickUnlockError('')
    setActivityRows([])
    rateLimiterRef.current = null
    // Prefs were wiped too: back to their defaults.
    setActiveTheme('system')
    setExplain(true)
  }

  /** Enter the create flow — generate the mnemonic once and move to the phrase screen. */
  function startCreate() {
    const m = generateMnemonic()
    setMnemonic(m)
    setRootKind('mnemonic')
    setIdentityName('default')
    setScreen('create-phrase')
  }

  /** Enter the import flow from the Restore screen, carrying the chosen root kind. */
  async function onImportValid(secret: string, name: string, kind: 'mnemonic' | 'nsec') {
    setMnemonic(secret)        // the pending root secret: 12 words, or an nsec
    setRootKind(kind)
    setIdentityName(name)
    const avail = await isBiometricAvailable()
    setBiometricAvailable(avail)
    setSetupMode('none')
    setSetupError('')
    setScreen('setup-unlock')
  }

  /** After the user confirms they've written down the phrase, pick indices and go to confirm. */
  function onPhraseContinue() {
    setPicks(pickConfirmIndices(12, 2))
    setScreen('confirm-backup')
  }

  /** After backup confirmed, resolve biometric availability and go to setup-unlock. */
  async function onBackupConfirmed() {
    const avail = await isBiometricAvailable()
    setBiometricAvailable(avail)
    setSetupMode('none')
    setSetupError('')
    setScreen('setup-unlock')
  }

  /** Complete setup: store the first identity, mark backed up, enter the app. */
  async function finishSetup(mk: string) {
    if (!mnemonic) return
    const identity = rootKind === 'nsec' ? identityFromNsec(mnemonic, identityName) : deriveIdentity(mnemonic, identityName)
    await addIdentityRecord({
      name: identity.name,
      npub: identity.npub,
      pubkeyHex: identity.pubkeyHex,
      ...(rootKind === 'nsec' ? { derivation: 'root' as const } : {}),
    })
    await markBackedUp()
    await enterWithMasterKey(mk)
    setMnemonic(null)
  }

  /** PIN-only setup path. */
  async function onPin(pin: string) {
    if (!mnemonic) return
    setBusy(true)
    setSetupError('')
    try {
      // Writing a new master over an existing one is always a full reset (H1): the confirmed
      // restore-from-Unlock path, and — defensively — any other route that reaches setup while a
      // master is stored. Every store is wiped in the same transaction that saves the new master.
      const replaceExisting = restoreReplacing || !!(await loadMaster())
      if (setupMode === 'biometric-needs-pin') {
        // Secure quick unlock: PIN + WebAuthn PRF wraps the master key. No PIN-only wrap is stored.
        const secure = await setupWithPinPrf(mnemonic, pin, rootKind, undefined, { replaceExisting })
        if (!secure.ok || !secure.masterKey) {
          setBiometricAvailable(false)
          setSetupMode('none')
          setSetupError('Face ID is not available for secure key storage here. Use your PIN instead.')
          return
        }
        if (replaceExisting) resetDeviceState()
        setMasterExists(true) // L1: the new master is now stored, however finishSetup below turns out
        await finishSetup(secure.masterKey)
      } else {
        // PIN-only
        await setupWithPin(mnemonic, pin, rootKind, { replaceExisting })
        if (replaceExisting) resetDeviceState()
        setMasterExists(true) // L1: same — the write already landed
        const mk = await unlockWithPin(pin)
        if (!mk) return
        await finishSetup(mk)
      }
    } catch {
      // Includes a failure opening the new session (M3) — say so instead of hanging silently.
      setSetupError('Could not finish setting up. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  /** Face ID path: ask user to enter backup PIN first, then set up biometric on top. */
  function onBiometric() {
    setSetupError('')
    setSetupMode('biometric-needs-pin')
  }

  async function doUpgradeQuickUnlock(pin: string) {
    setBusy(true)
    setQuickUnlockError('')
    try {
      const result = await upgradePinToPinPrf(pin)
      if (!result.ok) {
        setQuickUnlockError(result.reason === 'not-backed-up'
          ? 'Back up your recovery phrase first, then turn on secure quick unlock.'
          : 'Could not secure quick unlock. Check your PIN and try again.')
        return
      }
      setCanUpgradeQuickUnlock(false)
      setScreen('settings')
    } catch {
      setQuickUnlockError('Could not secure quick unlock. Check your PIN and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function onAddIdentity(name: string) {
    if (!session || !name.trim()) return
    const added = await addIdentityLive({ session, name: name.trim() })
    const stored = await listIdentities()
    setIdentities(stored.map(i => ({ name: i.name, npub: i.npub })))
    // Pull the new identity's kind 0 (if it has one), then repaint.
    const prefs = await loadPrefs()
    const pubkeyHex = stored.find(i => i.name === added.name)?.pubkeyHex
    if (pubkeyHex) await refreshProfiles(prefs.relays, [{ name: added.name, pubkeyHex }])
    await loadProfileData()
  }

  async function onDeleteIdentity(name: string) {
    if (!session) return
    await removeIdentityLive({ session, name })
    setIdentities((await listIdentities()).map(i => ({ name: i.name, npub: i.npub })))
    await loadProfileData()
    await refreshConnectedCount()
  }

  async function onConnect(uri: string, identName: string, askEachTime: boolean) {
    if (!session) return
    setConnectError('')
    try {
      const { appName } = await connectApp({ session, uri, identityName: identName, askEachTime })
      await refreshConnectedCount()
      // Land on a success confirmation with a shortcut into Connected apps, rather than
      // dropping silently to Home, so the user can name the app and set what it can do.
      setJustConnected(appName)
      setScreen('connect-done')
    } catch {
      setConnectError('That connection link is not valid.')
    }
  }

  function handleBunker(name: string) {
    if (!session) return
    const { pubkeyHex, secret } = session.signer.enableBunker(name)
    void loadPrefs().then(p => {
      setBunkerUri(buildBunkerUri({ pubkeyHex, relays: p.relays, secret }))
      setBunkerIdentity(name)
      setJustConnected(null)
      setScreen('bunker')
    })
  }

  function leaveBunker() {
    if (session && bunkerIdentity) session.signer.disableBunker(bunkerIdentity)
    setBunkerIdentity(null)
    setJustConnected(null)
    setScreen('home')
  }

  /** Shortcut from a connect success screen into the Connected apps list. Tears down any pending
   *  bunker secret first (like leaveBunker) so an unused link can't linger; connect-done has none. */
  function manageConnectedApps() {
    if (session && bunkerIdentity) session.signer.disableBunker(bunkerIdentity)
    setBunkerIdentity(null)
    setJustConnected(null)
    void enterConnectedApps()
  }

  /** Mint a fresh bunker secret for an app's identity and return a bunker:// link to copy. Same
   *  mechanism as "Create a link for an app", pre-scoped to this app's identity, so the user can
   *  re-link it (or set it up on another device) without walking the connect flow again. */
  function copyBunkerForApp(identityName: string): string {
    if (!session) return ''
    const { pubkeyHex, secret } = session.signer.enableBunker(identityName)
    return buildBunkerUri({ pubkeyHex, relays, secret })
  }

  /** Settle the request `id` the user saw (H5). The decision is bound to that id: if it is no
   *  longer on screen (it timed out) or is already being decided (double tap), this is a no-op,
   *  so it can never approve the next request in the queue. */
  async function decideApproval(id: number, ok: boolean, alwaysAllow: boolean) {
    const queue = approvalQueue()
    const item = queue.head()
    if (!item || item.id !== id || decidingRef.current.has(id)) return
    decidingRef.current.add(id)
    try {
      if (alwaysAllow && ok) await persistAlwaysAllow(item)
    } finally {
      decidingRef.current.delete(id)
      // Settle this request and advance to the next prompt (or back Home) via the queue's
      // onHead. A no-op if it timed out while the policy was being saved.
      queue.decide(id, ok)
    }
  }

  async function persistAlwaysAllow(item: PendingApproval) {
    const kind = item.req.eventDetails?.kind
    const existing = await getApp(item.req.identityName, item.req.clientPubkey)
    if (item.req.method === 'sign_event' && kind !== undefined && kind !== 0) {
      // Granular: "always allow" a sign grants only THIS kind, not all signing.
      if (existing) await setAppKindPolicy(item.req.identityName, item.req.clientPubkey, kind, 'always')
      else await putApp({ ...appRecordFromRequest(item.req, appPolicies({})), kindPolicies: { [String(kind)]: 'always' } })
    } else {
      // DMs and kind-0 profile writes stay category-wide.
      const category = categoryForRequest(item.req.method, kind)
      if (category) {
        const policies: AppPolicies = { ...appPolicies(existing ?? {}), [category]: 'always' }
        await putApp(existing ? { ...existing, policies } : appRecordFromRequest(item.req, policies))
      }
    }
  }

  async function doRevoke(identityName: string, pk: string) {
    if (!session) return
    await revokeApp({ session, identityName, clientPubkey: pk })
    rateLimiterRef.current?.reset(makeAppKey(identityName, pk))
    setApps(await listApps())
    await refreshConnectedCount()
  }

  async function doRenameApp(identityName: string, pk: string, label: string) {
    await renameApp(identityName, pk, label)
    setApps(await listApps())
  }

  async function doSetAppPolicy(identityName: string, pk: string, category: keyof AppPolicies, value: ActionPolicy | ProfilePolicy) {
    await setAppPolicy(identityName, pk, category, value)
    setApps(await listApps())
  }

  async function doResetKindPolicy(identityName: string, pk: string, kind: number) {
    await setAppKindPolicy(identityName, pk, kind, null)
    setApps(await listApps())
  }

  async function toggleExplain(next: boolean) {
    setExplain(next)
    const prefs = await loadPrefs()
    await savePrefs({ ...prefs, explain: next })
  }

  async function enterConnectedApps() {
    const [appsList, prefs] = await Promise.all([listApps(), loadPrefs()])
    setApps(appsList)
    // Hold the user's relays so copyBunkerForApp can build a link synchronously (clipboard write
    // must stay inside the click gesture).
    setRelays(prefs.relays)
    setScreen('connected-apps')
  }

  /** Build display rows for the activity log: resolve each entry's app to its display name from
   *  the stored apps, falling back to a short pubkey for an app that has since been revoked. */
  async function enterActivity(scope?: { identityName: string; clientPubkey: string; appName: string }) {
    const list = await listActivity(scope ? { identityName: scope.identityName, clientPubkey: scope.clientPubkey } : {})
    const nameByKey = new Map((await listApps()).map(a => [makeAppKey(a.identityName, a.clientPubkey), appDisplayName(a)]))
    const rows: ActivityRow[] = list
      .filter(e => e.id !== undefined)
      .map(e => ({
        id: e.id!,
        ts: e.ts,
        // The app's current name wins (so a rename flows through to history); the at-log-time
        // snapshot only fills in for an app that's since been forgotten; then a pubkey stub.
        appName: activityAppName(nameByKey.get(makeAppKey(e.identityName, e.clientPubkey)), e.appName, e.clientPubkey),
        identityName: e.identityName,
        method: e.method,
        kind: e.kind,
        outcome: e.outcome,
        auto: e.auto ?? false,
        rateLimited: e.rateLimited ?? false,
        timedOut: e.timedOut ?? false,
        errorCode: e.errorCode,
      }))
    setActivityRows(rows)
    setActivityScope(scope ?? null)
    setScreen('activity')
  }

  async function doClearActivity() {
    await clearActivity(activityScope ? { identityName: activityScope.identityName, clientPubkey: activityScope.clientPubkey } : undefined)
    await enterActivity(activityScope ?? undefined)
  }

  async function enterRelays() {
    const prefs = await loadPrefs()
    setRelays(prefs.relays)
    setBlossomServer(prefs.blossomServer)
    setRelayError('')
    setBlossomError('')
    setScreen('relays')
  }

  async function doSetBlossom(url: string) {
    let next: string
    try {
      next = url.trim() ? normaliseBlossomServer(url) : 'https://blossom.band'
    } catch {
      setBlossomError('Enter a valid https:// image server URL.')
      return
    }
    const prefs = await loadPrefs()
    await savePrefs({ ...prefs, blossomServer: next })
    setBlossomError('')
    setBlossomServer(next)
  }

  /** Open the profile editor for an identity: pre-fill from the local copy, then fetch the freshest
   *  kind-0 from the relays so editing tweaks the live profile rather than overwriting it. */
  async function enterProfile(name: string) {
    if (!session) return
    setProfileName(name)
    setProfileError('')
    setProfileSaving(false)
    setProfileLoading(true)
    setScreen('profile')
    const [local, prefs] = await Promise.all([loadProfile(name), loadPrefs()])
    let meta: ProfileMetadata = local?.metadata ?? {}
    let base: Record<string, unknown> = {}
    const pubkeyHex = session.signer.listIdentities().find(i => i.name === name)?.pubkeyHex
    if (pubkeyHex) {
      try {
        const fetched = await fetchKind0(prefs.relays, pubkeyHex)
        if (fetched) { meta = fetched.metadata; base = fetched.raw }
      } catch { /* relays slow/unavailable — fall back to the local copy */ }
    }
    setProfileMeta(meta)
    setProfileBase(base)
    setProfileAvatarUrl(prev => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
      return local?.avatarBlob ? URL.createObjectURL(local.avatarBlob) : meta.picture
    })
    setProfileLoading(false)
  }

  async function onSaveProfile(metadata: ProfileMetadata, newAvatar?: Blob) {
    if (!session) return
    setProfileSaving(true)
    setProfileError('')
    try {
      const prefs = await loadPrefs()
      await publishProfile({ session, identityName: profileName, metadata, base: profileBase, newAvatar, blossomServer: prefs.blossomServer })
      await loadProfileData()
      setProfileSaving(false)
      setScreen('home')
    } catch {
      setProfileSaving(false)
      setProfileError('Could not publish your profile. Check your image server in Settings → Relays and try again.')
    }
  }

  async function doAddRelay(url: string) {
    if (!session) return
    const result = addRelay(relays, url)
    if (result.error) {
      setRelayError(result.error)
      return
    }
    setRelayError('')
    const next = result.relays
    const prefs = await loadPrefs()
    await savePrefs({ ...prefs, relays: next })
    setRelays(next)
    // Keep listening on paired apps' own relays too (M1).
    session.relay.setRelays(await loadSessionRelays(next))
  }

  async function doRemoveRelay(url: string) {
    if (!session) return
    const next = removeRelay(relays, url)
    const prefs = await loadPrefs()
    await savePrefs({ ...prefs, relays: next })
    setRelays(next)
    // Keep listening on paired apps' own relays too (M1).
    session.relay.setRelays(await loadSessionRelays(next))
  }

  if (screen === 'loading') return (
    <main className="page">
      <Brand />
      <p className="section-title" style={{ textAlign: 'center', marginTop: 24 }}>Loading…</p>
      {bootSlow && (
        <div className="card card-warning" role="status" style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 18 }}>
          Still loading. Close any other My Signet Lite tabs or installed app windows, then reload.
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      )}
    </main>
  )
  if (screen === 'home' && session) return <Home identities={identities.map(i => ({ ...i, avatarUrl: profileData[i.name]?.avatarUrl, displayName: profileData[i.name]?.displayName }))} explain={explain} keepAwake={session !== null && connectedCount > 0 && wakeLockSupported} rootIdentityName={rootIdentityName ?? undefined} onAddIdentity={n => onAddIdentity(n)} onDeleteIdentity={n => void onDeleteIdentity(n)} onEditProfile={n => void enterProfile(n)} onConnect={() => { setConnectError(''); setScreen('connect') }} onSettings={() => { void enterSettings() }} onLock={lock} />
  if (screen === 'settings' && session) return (
    <Settings
      theme={activeTheme}
      onSetTheme={t => { void persistTheme(t); setActiveTheme(t) }}
      explain={explain}
      onToggleExplain={next => void toggleExplain(next)}
      canUpgradeQuickUnlock={canUpgradeQuickUnlock}
      onUpgradeQuickUnlock={() => { setQuickUnlockError(''); setScreen('upgrade-pin-prf') }}
      onBackup={() => setScreen('backup')}
      onMoveToMySignet={() => setScreen('move-to-mysignet')}
      onConnectedApps={() => void enterConnectedApps()}
      onActivity={() => void enterActivity()}
      onRelays={() => void enterRelays()}
      onLock={lock}
      onDeleteSignet={() => setScreen('delete-signet')}
      onBack={() => setScreen('home')}
    />
  )
  if (screen === 'upgrade-pin-prf' && session) return (
    <main className="page">
      <h2 style={{ textAlign: 'center', fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Secure quick unlock</h2>
      <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12.5, lineHeight: 1.5, margin: '0 14px 18px' }}>
        Enter your current PIN, then approve secure key storage. After this, your browser database cannot be tested against the PIN by itself.
      </p>
      {quickUnlockError && <p role="alert" style={{ color: 'var(--danger)', textAlign: 'center', fontSize: 13, margin: '0 0 14px' }}>{quickUnlockError}</p>}
      <PinPad onComplete={pin => { void doUpgradeQuickUnlock(pin) }} disabled={busy} label="Enter your PIN" />
      <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} disabled={busy} onClick={() => setScreen('settings')}>
        Cancel
      </button>
    </main>
  )
  if (screen === 'delete-signet' && session) return <DeleteSignet onConfirm={() => void doDeleteSignet()} onCancel={() => setScreen('settings')} />
  if (screen === 'backup' && session) return <Backup biometricAvailable={biometricAvailable} onDone={() => setScreen('settings')} />
  if (screen === 'move-to-mysignet' && session) return (
    <MoveToMySignet
      identities={identities.map(i => ({ ...i, displayName: profileData[i.name]?.displayName }))}
      biometricAvailable={biometricAvailable}
      onDone={() => setScreen('settings')}
    />
  )
  if (screen === 'connected-apps' && session) return (
    <ConnectedApps
      apps={apps.map(a => ({ clientPubkey: a.clientPubkey, displayName: appDisplayName(a), identityName: a.identityName, policies: appPolicies(a), kindPolicies: a.kindPolicies ?? {} }))}
      explain={explain}
      onAddConnection={() => { setConnectError(''); setScreen('connect') }}
      onRename={(identityName, pk, label) => void doRenameApp(identityName, pk, label)}
      onSetPolicy={(identityName, pk, cat, val) => void doSetAppPolicy(identityName, pk, cat, val)}
      onResetKind={(identityName, pk, kind) => void doResetKindPolicy(identityName, pk, kind)}
      onRevoke={(identityName, pk) => void doRevoke(identityName, pk)}
      onCopyBunker={(identityName) => copyBunkerForApp(identityName)}
      onViewActivity={(identityName, pk) => {
        const app = apps.find(a => a.identityName === identityName && a.clientPubkey === pk)
        void enterActivity({ identityName, clientPubkey: pk, appName: app ? appDisplayName(app) : `App ${pk.slice(0, 8)}` })
      }}
      onBack={() => setScreen('settings')}
    />
  )
  if (screen === 'activity' && session) return (
    <Activity
      entries={activityRows}
      nowSeconds={Math.floor(Date.now() / 1000)}
      explain={explain}
      scopeLabel={activityScope?.appName}
      onClear={() => void doClearActivity()}
      onBack={() => setScreen(activityScope ? 'connected-apps' : 'settings')}
    />
  )
  if (screen === 'relays' && session) return (
    <Relays
      relays={relays}
      error={relayError}
      onAdd={url => void doAddRelay(url)}
      onRemove={url => void doRemoveRelay(url)}
      onBack={() => setScreen('settings')}
      blossomServer={blossomServer}
      blossomError={blossomError}
      onSetBlossom={url => void doSetBlossom(url)}
    />
  )
  if (screen === 'profile' && session) return (
    <Profile
      key={`${profileName}-${profileLoading ? 'loading' : 'ready'}`}
      identityName={profileData[profileName]?.displayName ?? profileName}
      explain={explain}
      initialMetadata={profileMeta}
      initialAvatarUrl={profileAvatarUrl}
      loading={profileLoading}
      saving={profileSaving}
      error={profileError || undefined}
      onSave={(m, a) => void onSaveProfile(m, a)}
      onBack={() => setScreen('home')}
    />
  )
  if (screen === 'connect' && session) return <Connect identities={identities} explain={explain} onConnect={(u, n, a) => void onConnect(u, n, a)} onBunker={n => handleBunker(n)} onCancel={() => setScreen('home')} error={connectError} />
  if (screen === 'connect-done' && session) return <ConnectDone appName={justConnected ?? undefined} onManageApps={manageConnectedApps} onDone={() => { setJustConnected(null); setScreen('home') }} />
  if (screen === 'bunker') return <Bunker uri={bunkerUri} identityName={bunkerIdentity ?? undefined} appName={justConnected ?? undefined} onManageApps={manageConnectedApps} onDone={leaveBunker} />
  // L1: session-guarded — a stray post-lock enqueue must never show a prompt on a locked app.
  if (screen === 'approve' && pending && session) return (
    <ApproveSign
      key={pending.id}
      req={pending.req}
      appName={pending.appName}
      rateLimited={pending.rateLimited}
      explain={explain}
      onDecide={(ok, aa) => void decideApproval(pending.id, ok, aa)}
    />
  )
  if (screen === 'unlock') return <Unlock biometricAvailable={biometricAvailable} onUnlocked={enterWithMasterKey} onRestore={() => setScreen('restore-warning')} />
  // H1: restoring while locked replaces this signet entirely — warn and require confirmation first.
  if (screen === 'restore-warning') return (
    <RestoreWarning
      onConfirm={() => { setRestoreReplacing(true); setScreen('import') }}
      onCancel={() => setScreen('unlock')}
    />
  )

  if (screen === 'create-phrase' && mnemonic) {
    return <RecoveryPhrase words={mnemonic.split(' ')} onContinue={onPhraseContinue} />
  }

  if (screen === 'confirm-backup' && mnemonic) {
    return (
      <ConfirmBackup
        words={mnemonic.split(' ')}
        picks={picks}
        onConfirmed={() => { void onBackupConfirmed() }}
      />
    )
  }

  if (screen === 'setup-unlock') {
    if (setupMode === 'biometric-needs-pin') {
      return (
        <main className="page">
          <h2 style={{ textAlign: 'center', fontWeight: 700, fontSize: 17, marginBottom: 8 }}>First, set a backup PIN</h2>
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12.5, lineHeight: 1.5, margin: '0 14px 22px' }}>
            Face ID protects your saved key with this device's secure hardware. The PIN is a fallback, but the stored key cannot be tested against the PIN alone.
          </p>
          <PinPad onComplete={pin => { void onPin(pin) }} disabled={busy} label="Enter a 6-digit PIN" />
        </main>
      )
    }
    return (
      <SetupUnlock
        biometricAvailable={biometricAvailable}
        onPin={pin => { void onPin(pin) }}
        onBiometric={onBiometric}
        busy={busy}
        error={setupError}
      />
    )
  }

  if (screen === 'import') return (
    <Import
      onValid={(m, name, kind) => { void onImportValid(m, name, kind) }}
      // Backing out of a restore-from-Unlock returns to Unlock with nothing erased — never to
      // Welcome, whose Create would write a new master under the old data.
      onBack={() => {
        if (restoreReplacing) { setRestoreReplacing(false); setScreen('unlock') }
        else setScreen('welcome')
      }}
    />
  )

  // L1: routing decides from stored state, not from a possibly-stale `screen` value — any
  // unhandled state (e.g. a locked app whose screen briefly bounced through 'approve'/'home')
  // must resolve to Unlock whenever a master is known to be stored. Welcome's Create/Import would
  // otherwise wipe it with no warning.
  if (masterExists) return <Unlock biometricAvailable={biometricAvailable} onUnlocked={enterWithMasterKey} onRestore={() => setScreen('restore-warning')} />

  // Welcome screen
  return <Welcome onCreate={startCreate} onImport={() => setScreen('import')} />
}
