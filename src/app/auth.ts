// My Signet Lite unlock module. Two-layer key wrapping (audited pattern from
// signet-app/src/lib/auth.ts): a random master key encrypts the mnemonic once;
// that master key is wrapped under legacy PIN-only storage or, on supported devices,
// PIN + WebAuthn PRF secure quick unlock.

import { encryptSecret, decryptSecret, encryptWithKey, decryptWithKey } from '../engine/crypto-store.js'
import { SALT_LENGTH } from '../engine/aes-crypto.js'
import { generateMasterKey, deriveKeyFromPRF, deriveKeyFromPinAndPRF, PRF_SALT } from './auth-crypto.js'
import { saveMaster, loadMaster, updateMaster, clearAll, type StoredMaster } from './db.js'

const PIN_FAILURE_LIMIT = 5
const PIN_LOCKOUT_MS = 30_000

/** Options for writing a brand-new master. `replaceExisting` is the restore-over-an-existing-
 *  signet path (H1): every other store is wiped in the same transaction that writes the new
 *  master (the same wipe Delete signet uses), so nothing of the previous signet survives. */
export interface SetupOptions { replaceExisting?: boolean }

async function writeNewMaster(m: StoredMaster, opts: SetupOptions): Promise<void> {
  if (opts.replaceExisting) await clearAll({ replacementMaster: m })
  else await saveMaster(m)
}

/** Record one failed PIN attempt against the CURRENT stored throttle (atomic, L7). */
async function recordPinFailure(now: number): Promise<void> {
  await updateMaster(cur => {
    const failures = (cur.pinFailures ?? 0) + 1
    const lockedUntil = failures >= PIN_FAILURE_LIMIT ? now + PIN_LOCKOUT_MS : (cur.pinLockedUntil ?? 0)
    return { ...cur, pinFailures: failures, pinLockedUntil: lockedUntil }
  })
}

/** Clear the PIN throttle after a correct PIN (atomic, L7). */
async function clearPinFailures(): Promise<void> {
  await updateMaster(cur => ((cur.pinFailures ?? 0) !== 0 || (cur.pinLockedUntil ?? 0) !== 0)
    ? { ...cur, pinFailures: 0, pinLockedUntil: 0 }
    : null)
}

/** Set up unlock with a 6-digit PIN. `secret` is the 12 words for a mnemonic master
 *  or the nsec string for an nsec master. nsec masters are backed-up by definition. */
export async function setupWithPin(secret: string, pin: string, rootKind: 'mnemonic' | 'nsec' = 'mnemonic', opts: SetupOptions = {}): Promise<void> {
  if (!/^\d{6}$/.test(pin)) throw new Error('PIN must be 6 digits')
  const masterKey = generateMasterKey()
  const ciphertext = await encryptSecret(secret, masterKey)
  const wrapped = await encryptSecret(masterKey, pin)
  await writeNewMaster({ ciphertext, backedUp: rootKind === 'nsec', rootKind, pin: { wrapped }, pinFailures: 0, pinLockedUntil: 0 }, opts)
}

/** Set up secure quick unlock: the master key is wrapped by PIN + WebAuthn PRF, not PIN alone.
 *  A biometric PRF-only wrap is also stored so supported devices can still unlock with Face ID. */
export async function setupWithPinPrf(
  secret: string,
  pin: string,
  rootKind: 'mnemonic' | 'nsec' = 'mnemonic',
  io: WebAuthnIO = realIO,
  opts: SetupOptions = {},
): Promise<SetupBiometricResult> {
  if (!/^\d{6}$/.test(pin)) throw new Error('PIN must be 6 digits')
  const created = await io.create()
  if (!created?.prfOutput) return { ok: false, prfSupported: false }

  const masterKey = generateMasterKey()
  const ciphertext = await encryptSecret(secret, masterKey)
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const pinPrfKey = await deriveKeyFromPinAndPRF(pin, created.prfOutput, salt)
  const pinPrfWrapped = await encryptWithKey(masterKey, pinPrfKey)
  const biometricKey = await deriveKeyFromPRF(created.prfOutput)
  const biometricWrapped = await encryptWithKey(masterKey, biometricKey)

  await writeNewMaster({
    ciphertext,
    backedUp: rootKind === 'nsec',
    rootKind,
    pinPrf: { credentialId: created.credentialId, wrapped: pinPrfWrapped, salt: b64encode(salt) },
    biometric: { credentialId: created.credentialId, prf: true, wrapped: biometricWrapped },
    pinFailures: 0,
    pinLockedUntil: 0,
  }, opts)
  return { ok: true, prfSupported: true, masterKey }
}

/** Upgrade an existing PIN-only install to PIN + WebAuthn PRF. On success the legacy
 *  PIN-only wrap is removed, so an IndexedDB copy no longer has a six-digit offline target. */
export async function upgradePinToPinPrf(pin: string, io: WebAuthnIO = realIO): Promise<SetupBiometricResult> {
  const m = await loadMaster()
  if (!m?.pin || m.pinPrf) return { ok: false, prfSupported: false }
  // Refuse to drop the PIN-only fallback unless the recovery phrase is backed up — otherwise a
  // later PRF failure would mean permanent key loss instead of a recoverable re-import.
  if (!m.backedUp) return { ok: false, prfSupported: false, reason: 'not-backed-up' }
  const masterKey = await unlockLegacyPin(m, pin)
  if (!masterKey) return { ok: false, prfSupported: false }

  const created = await io.create()
  if (!created?.prfOutput) return { ok: false, prfSupported: false }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const pinPrfKey = await deriveKeyFromPinAndPRF(pin, created.prfOutput, salt)
  const pinPrfWrapped = await encryptWithKey(masterKey, pinPrfKey)
  const biometricKey = await deriveKeyFromPRF(created.prfOutput)
  const biometricWrapped = await encryptWithKey(masterKey, biometricKey)
  // Re-read inside the write (L7): if the record changed underneath us (another tab upgraded, or
  // the root was replaced), don't clobber it with a wrap of a stale master key.
  let applied = false
  await updateMaster(cur => {
    if (cur.ciphertext !== m.ciphertext || !cur.pin || cur.pinPrf) return null
    const { pin: _legacyPin, ...rest } = cur
    applied = true
    return {
      ...rest,
      pinPrf: { credentialId: created.credentialId, wrapped: pinPrfWrapped, salt: b64encode(salt) },
      biometric: { credentialId: created.credentialId, prf: true, wrapped: biometricWrapped },
      pinFailures: 0,
      pinLockedUntil: 0,
    }
  })
  if (!applied) return { ok: false, prfSupported: false }
  return { ok: true, prfSupported: true, masterKey }
}

/** Unlock with a PIN — returns the master key hex, or null on a wrong PIN / no master. */
export async function unlockWithPin(pin: string, io: WebAuthnIO = realIO): Promise<string | null> {
  const m = await loadMaster()
  if (!m?.pin && !m?.pinPrf) return null
  const now = Date.now()
  if ((m.pinLockedUntil ?? 0) > now) return null
  try {
    let masterKey: string
    if (m.pinPrf) {
      const assertion = await io.assert(m.pinPrf.credentialId)
      if (!assertion?.prfOutput) return null
      const key = await deriveKeyFromPinAndPRF(pin, assertion.prfOutput, b64decode(m.pinPrf.salt))
      masterKey = await decryptWithKey(m.pinPrf.wrapped, key)
    } else {
      masterKey = await decryptSecret(m.pin!.wrapped, pin)
    }
    await clearPinFailures()
    return masterKey
  } catch {
    await recordPinFailure(now)
    return null
  }
}

async function unlockLegacyPin(m: StoredMaster, pin: string): Promise<string | null> {
  const now = Date.now()
  if (!m.pin || (m.pinLockedUntil ?? 0) > now) return null
  try {
    const masterKey = await decryptSecret(m.pin.wrapped, pin)
    await clearPinFailures()
    return masterKey
  } catch {
    await recordPinFailure(now)
    return null
  }
}

/** Decrypt the stored root secret and report its kind. */
export async function getRoot(masterKey: string): Promise<{ kind: 'mnemonic' | 'nsec'; secret: string }> {
  const m = await loadMaster()
  if (!m) throw new Error('no master record')
  const secret = await decryptSecret(m.ciphertext, masterKey)
  return { kind: m.rootKind ?? 'mnemonic', secret }
}

/** Back-compat wrapper: the decrypted root secret as a string (mnemonic callers). */
export async function getMnemonic(masterKey: string): Promise<string> {
  return (await getRoot(masterKey)).secret
}

/** Mark the recovery phrase as backed up (after the confirm-backup step). */
export async function markBackedUp(): Promise<void> {
  const m = await updateMaster(cur => ({ ...cur, backedUp: true }))
  if (!m) throw new Error('no master record')
}

// --- WebAuthn PRF I/O and biometric unlock ---

export interface CreatedCredential { credentialId: string; prfOutput: ArrayBuffer | null }
export interface AssertionResult { prfOutput: ArrayBuffer | null }

/** The WebAuthn I/O surface — injected so the orchestration is unit-testable without an authenticator. */
export interface WebAuthnIO {
  create(): Promise<CreatedCredential | null>
  assert(credentialId: string): Promise<AssertionResult | null>
}

export interface SetupBiometricResult { ok: boolean; prfSupported: boolean; masterKey?: string; reason?: 'not-backed-up' }

const b64encode = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const b64decode = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

// A platform authenticator rejects concurrent get()/create() calls, so only ONE WebAuthn
// ceremony may be in flight at a time. Starting a new one aborts any pending one, so the latest
// caller wins — e.g. a PIN-triggered assertion supersedes the unlock screen's auto Face ID
// attempt instead of both failing with "a request is already pending".
let pendingCeremony: AbortController | null = null
function freshCeremonySignal(): AbortSignal {
  pendingCeremony?.abort()
  pendingCeremony = new AbortController()
  return pendingCeremony.signal
}

export function cancelPendingWebAuthnCeremony(): void {
  pendingCeremony?.abort()
  pendingCeremony = null
}

/** Add a biometric wrap of the master key. Caller must already hold an unlocked masterKey. */
export async function enableBiometric(masterKey: string, io: WebAuthnIO = realIO): Promise<SetupBiometricResult> {
  const m = await loadMaster()
  if (!m) throw new Error('no master record')

  const created = await io.create()
  if (!created) return { ok: false, prfSupported: false }

  if (created.prfOutput) {
    const key = await deriveKeyFromPRF(created.prfOutput)
    const wrapped = await encryptWithKey(masterKey, key)
    // L7: re-read inside the write, same as upgradePinToPinPrf — if the root was replaced
    // underneath us (another tab, a restore) during the WebAuthn ceremony, the write is skipped.
    // Track that explicitly instead of assuming success: reporting ok:true when nothing was
    // written would tell the UI Face ID is on when it isn't.
    let applied = false
    await updateMaster(cur => {
      if (cur.ciphertext !== m.ciphertext) return null
      applied = true
      return { ...cur, biometric: { credentialId: created.credentialId, prf: true, wrapped } }
    })
    if (!applied) return { ok: false, prfSupported: false }
    return { ok: true, prfSupported: true }
  }

  // Non-PRF authenticators do not provide secret key material. Do not store the
  // legacy credential-ID-derived fallback because IndexedDB theft can decrypt it offline.
  await updateMaster(cur => ({ ...cur, biometric: undefined }))
  return { ok: false, prfSupported: false }
}

/** Unlock with biometric — returns the master key hex, or null. */
export async function unlockWithBiometric(io: WebAuthnIO = realIO): Promise<string | null> {
  const m = await loadMaster()
  if (!m?.biometric) return null
  const bio = m.biometric

  const assertion = await io.assert(bio.credentialId)
  if (!assertion) return null // cancelled / failed

  try {
    let key: CryptoKey
    if (bio.prf) {
      if (!assertion.prfOutput) return null
      key = await deriveKeyFromPRF(assertion.prfOutput)
    } else {
      return null
    }
    return await decryptWithKey(bio.wrapped, key)
  } catch {
    return null
  }
}

/** Whether a user-verifying platform authenticator is available. */
export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

function getRpId(): string {
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' ? h : 'lite.mysignet.app'
}

/** Real navigator.credentials-backed I/O. Not unit-tested (needs an authenticator). */
export const realIO: WebAuthnIO = {
  async create() {
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    // A cancelled prompt (NotAllowedError), an RP-ID mismatch on a non-production host
    // (SecurityError) or an aborted ceremony all reject here. Treat each as "no credential" so
    // callers show their "Face ID unavailable" message instead of an unhandled rejection (L4).
    let credential: PublicKeyCredential | null
    try {
      credential = await navigator.credentials.create({
        signal: freshCeremonySignal(),
        publicKey: {
          challenge,
          rp: { name: 'My Signet Lite', id: getRpId() },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'signet-lite-user', displayName: 'Signet Lite User' },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
          extensions: { prf: {} } as Record<string, unknown>,
          timeout: 60000,
        },
      }) as PublicKeyCredential | null
    } catch {
      return null
    }
    if (!credential) return null
    const credentialId = b64encode(new Uint8Array(credential.rawId))
    const ext = (credential as PublicKeyCredential & { getClientExtensionResults(): Record<string, unknown> }).getClientExtensionResults()
    const prfEnabled = !!(ext?.prf && (ext.prf as Record<string, unknown>).enabled)
    // If PRF is enabled we still need an assertion to obtain its output.
    const prfOutput = prfEnabled ? await evalPrf(credentialId) : null
    return { credentialId, prfOutput }
  },
  async assert(credentialId) {
    return prfAssertion(credentialId)
  },
}

/** Run an assertion requesting the PRF output. Returns null if the assertion fails/cancels. */
async function prfAssertion(credentialIdB64: string): Promise<AssertionResult | null> {
  try {
    const id = b64decode(credentialIdB64)
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const assertion = await navigator.credentials.get({
      signal: freshCeremonySignal(),
      publicKey: {
        challenge,
        allowCredentials: [{ id, type: 'public-key', transports: ['internal'] }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: PRF_SALT } } } as Record<string, unknown>,
        timeout: 60000,
      },
    }) as PublicKeyCredential | null
    if (!assertion) return null
    const ext = (assertion as PublicKeyCredential & { getClientExtensionResults(): Record<string, unknown> }).getClientExtensionResults()
    const prf = ext?.prf as Record<string, unknown> | undefined
    const results = prf?.results as Record<string, ArrayBuffer> | undefined
    return { prfOutput: results?.first ?? null }
  } catch {
    return null
  }
}

/** Helper used by realIO.create to fetch the PRF output immediately after enrolment. */
async function evalPrf(credentialIdB64: string): Promise<ArrayBuffer | null> {
  const r = await prfAssertion(credentialIdB64)
  return r?.prfOutput ?? null
}
