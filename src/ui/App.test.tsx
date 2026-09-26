// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { setupWithPin } from '../app/auth.js'
import * as auth from '../app/auth.js'
import { __resetDbForTests, addIdentityRecord, loadMaster, listIdentities, putApp, listApps, loadProfile, appendActivity, listActivity, savePrefs, loadPrefs } from '../app/db.js'
import { saveProfile } from '../app/db.js'
import * as refresh from './profile/refresh-profiles.js'
import { deriveIdentity } from '../engine/derive.js'
import { deleteDB } from 'idb'
import * as unlockMod from './unlock-session.js'
vi.mock('./profile/refresh-profiles.js', () => ({ refreshProfiles: vi.fn(async () => {}) }))

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

afterEach(cleanup)

describe('App scaffold', () => {
  it('mounts and shows the My Signet Lite wordmark', () => {
    render(<App />)
    expect(screen.getByText('My Signet')).toBeInTheDocument()
    expect(screen.getByText('Lite')).toBeInTheDocument()
  })
})

describe('App boot', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('shows the welcome screen when there is no master', async () => {
    render(<App />)
    expect(await screen.findByText('Create a new identity')).toBeInTheDocument()
  })

  it('shows the unlock screen when a master exists', async () => {
    await setupWithPin(M, '123456')
    render(<App />)
    expect(await screen.findByText('Unlock My Signet Lite')).toBeInTheDocument()
  })

  it('does not leave existing users on Loading while biometric availability is pending', async () => {
    await setupWithPin(M, '123456')
    const biometric = vi.spyOn(auth, 'isBiometricAvailable').mockImplementation(() => new Promise(() => {}))

    try {
      render(<App />)
      expect(await screen.findByLabelText('PIN entry')).toBeInTheDocument()
    } finally {
      biometric.mockRestore()
    }
  })
})

describe('App create flow', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('create flow with a PIN lands on home with one identity', async () => {
    render(<App />)

    // Welcome → start create
    await userEvent.click(await screen.findByText('Create a new identity'))

    // RecoveryPhrase screen: read all 12 words from the numbered grid before continuing.
    // Each word cell has a number span and a word span as siblings inside a flex div.
    await screen.findByText("I've written them down")
    // Build a words array by reading numbered entries: find spans containing "1","2",...,"12"
    // then take the adjacent sibling word. We use aria-free approach: find all word items.
    // The RecoveryPhrase renders: <span>{i+1}</span><span>{word}</span> inside each cell.
    // Find all number spans (1–12), then navigate to sibling word span.
    const words: string[] = []
    for (let n = 1; n <= 12; n++) {
      // Find the number element
      const numEl = screen.getByText(String(n))
      // Its parent cell div contains number + word as two children
      const cell = numEl.parentElement!
      const wordEl = cell.children[1] as HTMLElement
      words.push(wordEl.textContent ?? '')
    }
    expect(words).toHaveLength(12)

    await userEvent.click(screen.getByText("I've written them down"))

    // ConfirmBackup screen: read each "Word #N" label to know which words are asked for
    await screen.findByText('Confirm')
    const labelEls = screen.getAllByText(/^Word #\d+$/)
    for (const labelEl of labelEls) {
      const idxStr = labelEl.textContent!.replace('Word #', '')
      const wordIdx = parseInt(idxStr, 10) - 1
      const input = screen.getByLabelText(labelEl.textContent!)
      await userEvent.type(input, words[wordIdx])
    }
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    // SetupUnlock screen — biometric not available in jsdom, so PinPad shows directly
    await screen.findByLabelText('PIN entry')
    for (const d of ['1','2','3','4','5','6']) {
      await userEvent.click(screen.getByRole('button', { name: d }))
    }

    // Home screen
    expect(await screen.findByText('Your identities')).toBeInTheDocument()
  })
})

describe('App import flow', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('import flow with a valid phrase and default name lands on home with one identity', async () => {
    render(<App />)

    // Welcome → import
    await userEvent.click(await screen.findByText('I already have a backup'))

    // Import screen
    await screen.findByLabelText('Recovery phrase')
    await userEvent.type(screen.getByLabelText('Recovery phrase'), M)
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))

    // SetupUnlock — biometric not available in jsdom
    await screen.findByLabelText('PIN entry')
    for (const d of ['1','2','3','4','5','6']) {
      await userEvent.click(screen.getByRole('button', { name: d }))
    }

    // Home screen
    expect(await screen.findByText('Your identities')).toBeInTheDocument()
  })
})

describe('App unlock flow', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('with a pre-seeded master, boot shows unlock and PIN entry lands on home', async () => {
    await setupWithPin(M, '123456')
    render(<App />)

    // Unlock screen appears
    await screen.findByLabelText('PIN entry')
    for (const d of ['1','2','3','4','5','6']) {
      await userEvent.click(screen.getByRole('button', { name: d }))
    }

    // Home screen
    expect(await screen.findByText('Your identities')).toBeInTheDocument()
  })
})

// H1: "Can't unlock? Restore" is a full reset of this device, never a key swap under the old data.
describe('App restore from the Unlock screen (H1)', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })
  const OTHER = 'legal winner thank year wave sausage worth useful legal winner thank yellow'

  async function seedExistingSignet() {
    await setupWithPin(M, '123456')
    const id = deriveIdentity(M, 'default')
    await addIdentityRecord({ name: id.name, npub: id.npub, pubkeyHex: id.pubkeyHex })
    await putApp({ clientPubkey: 'c1', identityName: 'default', appName: 'Old app', policies: { sign: 'always', dm: 'always' }, connectedAt: 1 })
    await saveProfile({ name: 'default', metadata: { name: 'Victim' }, updatedAt: 1 })
    await appendActivity({ ts: Math.floor(Date.now() / 1000), identityName: 'default', clientPubkey: 'c1', method: 'sign_event', outcome: 'signed' })
    await savePrefs({ theme: 'dark', relays: ['wss://old.example'], explain: true, blossomServer: 'https://blossom.band' })
  }

  it('warns that everything will be erased, requires explicit confirmation, then wipes all old data', async () => {
    await seedExistingSignet()
    render(<App />)
    await screen.findByLabelText('PIN entry')
    await userEvent.click(screen.getByRole('button', { name: /restore from your recovery phrase/i }))

    // Warning screen: explicit, and gated behind an acknowledgement.
    expect(await screen.findByText(/erase everything on this device/i)).toBeInTheDocument()
    expect(screen.getByText(/can't be recovered without its recovery phrase/i)).toBeInTheDocument()
    const go = screen.getByRole('button', { name: /erase and restore/i })
    expect(go).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /i understand/i }))
    await userEvent.click(go)

    // Import a DIFFERENT phrase under a new name, set a new PIN.
    await screen.findByLabelText('Recovery phrase')
    await userEvent.clear(screen.getByLabelText('Identity name'))
    await userEvent.type(screen.getByLabelText('Identity name'), 'fresh')
    await userEvent.type(screen.getByLabelText('Recovery phrase'), OTHER)
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    await screen.findByLabelText('PIN entry')
    for (const d of ['6','5','4','3','2','1']) await userEvent.click(screen.getByRole('button', { name: d }))
    await screen.findByText('Your identities')

    // Only the restored identity exists; nothing of the previous signet survives.
    const fresh = deriveIdentity(OTHER, 'fresh')
    expect((await listIdentities()).map(i => i.npub)).toEqual([fresh.npub])
    expect(await listApps()).toEqual([])
    expect(await loadProfile('default')).toBeUndefined()
    expect(await listActivity()).toEqual([])
    expect((await loadPrefs()).relays).not.toContain('wss://old.example')
    expect(screen.getAllByTestId('identity-npub')).toHaveLength(1)
    // The old PIN no longer opens anything; the new one does.
    expect(await auth.unlockWithPin('123456')).toBeNull()
    expect(await auth.unlockWithPin('654321')).not.toBeNull()
  }, 30_000)

  it('cancelling the warning, or backing out of the import, returns to Unlock with data intact', async () => {
    await seedExistingSignet()
    render(<App />)
    await screen.findByLabelText('PIN entry')
    await userEvent.click(screen.getByRole('button', { name: /restore from your recovery phrase/i }))
    await userEvent.click(await screen.findByRole('button', { name: /cancel/i }))
    expect(await screen.findByText('Unlock My Signet Lite')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /restore from your recovery phrase/i }))
    await userEvent.click(await screen.findByRole('checkbox', { name: /i understand/i }))
    await userEvent.click(screen.getByRole('button', { name: /erase and restore/i }))
    await screen.findByLabelText('Recovery phrase')
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    // Not Welcome (whose "Create" would overwrite the master under the old data).
    expect(await screen.findByText('Unlock My Signet Lite')).toBeInTheDocument()
    expect(await listIdentities()).toHaveLength(1)
    expect(await listApps()).toHaveLength(1)
  })
})

describe('App unlock failure (M3)', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('shows an error on the Unlock screen when the session cannot be opened, and a retry works', async () => {
    await setupWithPin(M, '123456')
    const spy = vi.spyOn(unlockMod, 'unlockSession').mockRejectedValueOnce(new Error('bad relay'))
    try {
      render(<App />)
      await screen.findByLabelText('PIN entry')
      for (const d of ['1','2','3','4','5','6']) await userEvent.click(screen.getByRole('button', { name: d }))
      expect(await screen.findByText(/couldn't open your signet/i)).toBeInTheDocument()

      for (const d of ['1','2','3','4','5','6']) await userEvent.click(screen.getByRole('button', { name: d }))
      expect(await screen.findByText('Your identities')).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('App add-identity flow', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('unlock → home → add identity "work" → Home shows 2 identities', async () => {
    await setupWithPin(M, '123456')
    // Seed the initial 'default' identity so Home shows 1 on arrival
    const defaultId = deriveIdentity(M, 'default')
    await addIdentityRecord({ name: defaultId.name, npub: defaultId.npub, pubkeyHex: defaultId.pubkeyHex })
    render(<App />)

    // Unlock with PIN
    await screen.findByLabelText('PIN entry')
    for (const d of ['1','2','3','4','5','6']) {
      await userEvent.click(screen.getByRole('button', { name: d }))
    }

    // Home screen — one identity from setup
    await screen.findByText('Your identities')
    expect(screen.getAllByTestId('identity-npub')).toHaveLength(1)

    // Open add-identity form
    await userEvent.click(screen.getByRole('button', { name: /\+ add identity/i }))

    // Type name and submit
    await userEvent.type(screen.getByLabelText('New identity name'), 'work')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))

    // Home now shows 2 identities
    await waitFor(() => {
      expect(screen.getAllByTestId('identity-npub')).toHaveLength(2)
    })
  })
})

describe('App delete-signet flow', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('settings → delete signet → acknowledge → confirm wipes everything and returns to welcome', async () => {
    await setupWithPin(M, '123456')
    const defaultId = deriveIdentity(M, 'default')
    await addIdentityRecord({ name: defaultId.name, npub: defaultId.npub, pubkeyHex: defaultId.pubkeyHex })
    render(<App />)

    // Unlock with PIN → Home
    await screen.findByLabelText('PIN entry')
    for (const d of ['1','2','3','4','5','6']) {
      await userEvent.click(screen.getByRole('button', { name: d }))
    }
    await screen.findByText('Your identities')

    // Home → Settings → Danger zone → Delete signet
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    await userEvent.click(await screen.findByRole('button', { name: /delete signet/i }))

    // Confirmation screen: delete is gated until the recovery-phrase box is ticked.
    const del = await screen.findByRole('button', { name: /yes, delete everything/i })
    expect(del).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /recovery phrase/i }))
    await userEvent.click(del)

    // Lands back on the welcome/setup screen…
    expect(await screen.findByText('Create a new identity')).toBeInTheDocument()
    // …and every stored record is gone.
    expect(await loadMaster()).toBeUndefined()
    expect(await listIdentities()).toEqual([])
  })

  // L5: session.lock() (inside deleteSignet) settles any pending approval synchronously and fires
  // onActivity for it BEFORE the db wipe's own await resolves. That async write (getApp then
  // appendActivity) must never land after clearAll() and leave a stray row in the reset db.
  it('a lock-time activity event never writes a stray row into the wiped db', async () => {
    await setupWithPin(M, '123456')
    const defaultId = deriveIdentity(M, 'default')
    await addIdentityRecord({ name: defaultId.name, npub: defaultId.npub, pubkeyHex: defaultId.pubkeyHex })

    let capturedOnActivity: ((e: unknown) => void) | null = null
    const realUnlockSession = unlockMod.unlockSession
    const spy = vi.spyOn(unlockMod, 'unlockSession').mockImplementation(async (masterKey, opts) => {
      capturedOnActivity = (opts.onActivity ?? null) as ((e: unknown) => void) | null
      return realUnlockSession(masterKey, opts)
    })
    try {
      render(<App />)
      await screen.findByLabelText('PIN entry')
      for (const d of ['1', '2', '3', '4', '5', '6']) {
        fireEvent.click(screen.getByRole('button', { name: d }))
      }
      await screen.findByText('Your identities')
      expect(capturedOnActivity).not.toBeNull()

      await userEvent.click(screen.getByRole('button', { name: /settings/i }))
      await userEvent.click(await screen.findByRole('button', { name: /delete signet/i }))
      await userEvent.click(screen.getByRole('checkbox', { name: /recovery phrase/i }))
      const del = screen.getByRole('button', { name: /yes, delete everything/i })

      // Fire the confirm (kicks off the lock + wipe) and, immediately after — still synchronous,
      // no await in between — an activity event, mirroring session.lock() calling onActivity for
      // a settled lock-time denial before the wipe's own await resolves.
      fireEvent.click(del)
      capturedOnActivity!({ identityName: 'default', clientPubkey: 'f'.repeat(64), method: 'sign_event', kind: 1, outcome: 'denied', auto: false, rateLimited: false })

      expect(await screen.findByText('Create a new identity')).toBeInTheDocument()
      expect(await loadMaster()).toBeUndefined()
      expect(await listActivity()).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })

  it('cancel on the confirmation screen returns to settings without deleting', async () => {
    await setupWithPin(M, '123456')
    const defaultId = deriveIdentity(M, 'default')
    await addIdentityRecord({ name: defaultId.name, npub: defaultId.npub, pubkeyHex: defaultId.pubkeyHex })
    render(<App />)

    await screen.findByLabelText('PIN entry')
    for (const d of ['1','2','3','4','5','6']) {
      await userEvent.click(screen.getByRole('button', { name: d }))
    }
    await screen.findByText('Your identities')

    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    await userEvent.click(await screen.findByRole('button', { name: /delete signet/i }))
    await userEvent.click(await screen.findByRole('button', { name: /cancel/i }))

    // Back on Settings, data intact.
    expect(await screen.findByText('Settings')).toBeInTheDocument()
    expect(await loadMaster()).not.toBeUndefined()
  })
})

describe('App profile autopull', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })
  afterEach(() => { vi.mocked(refresh.refreshProfiles).mockImplementation(async () => {}) })

  it('refreshes profiles on unlock and shows the fetched display name on Home', async () => {
    await setupWithPin(M, '123456')
    const id = deriveIdentity(M, 'default')
    await addIdentityRecord({ name: id.name, npub: id.npub, pubkeyHex: id.pubkeyHex })
    // The mocked refresh writes a profile, exactly as the real one would after a relay hit.
    vi.mocked(refresh.refreshProfiles).mockImplementation(async () => {
      await saveProfile({ name: 'default', metadata: { display_name: 'TheCryptoDonkey' }, updatedAt: 1 })
    })
    render(<App />)

    await screen.findByLabelText('PIN entry')
    for (const d of ['1','2','3','4','5','6']) await userEvent.click(screen.getByRole('button', { name: d }))

    await screen.findByText('Your identities')
    expect(await screen.findByText('TheCryptoDonkey')).toBeInTheDocument()
    expect(refresh.refreshProfiles).toHaveBeenCalled()
  })

  it('revokes previous avatar object URLs when profile data reloads', async () => {
    const created: string[] = []
    const revoked: string[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const u = `blob:mock-${created.length}`
      created.push(u)
      return u
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(u => { revoked.push(u) })

    await setupWithPin(M, '123456')
    const id = deriveIdentity(M, 'default')
    await addIdentityRecord({ name: id.name, npub: id.npub, pubkeyHex: id.pubkeyHex })
    // Seed a profile with an avatarBlob so that loadProfileData calls createObjectURL.
    await saveProfile({ name: 'default', metadata: {}, avatarBlob: new Blob(['x'], { type: 'image/png' }), updatedAt: 1 })
    // The mocked refresh updates the profile (triggering a second loadProfileData after unlock).
    vi.mocked(refresh.refreshProfiles).mockImplementation(async () => {
      await saveProfile({ name: 'default', metadata: {}, avatarBlob: new Blob(['y'], { type: 'image/png' }), updatedAt: 2 })
    })

    render(<App />)

    await screen.findByLabelText('PIN entry')
    for (const d of ['1','2','3','4','5','6']) await userEvent.click(screen.getByRole('button', { name: d }))

    await screen.findByText('Your identities')
    // Wait for the second loadProfileData (triggered by refreshProfiles completing) to run.
    // The first blob URL must have been revoked by then.
    await vi.waitFor(() => { expect(revoked).toContain(created[0]) })
  })
})

// H3: the auto-lock clock belongs to an unlocked session, not to the page.
describe('App auto-lock is per session', () => {
  beforeEach(async () => {
    await __resetDbForTests(); await deleteDB('signet-lite')
    // Fake only the clock + setTimeout (IndexedDB runs on setImmediate), advancing with real time
    // so findBy polling still works.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true })
  })
  afterEach(() => { vi.useRealTimers() })

  const SIX_MIN = 6 * 60_000
  async function enterPinFast(pin: string) {
    await screen.findByLabelText('PIN entry')
    for (const d of pin) fireEvent.click(screen.getByRole('button', { name: d }))
  }

  it('does not auto-lock during onboarding (no session yet)', async () => {
    render(<App />)
    await screen.findByText('Create a new identity')
    await act(async () => { vi.advanceTimersByTime(SIX_MIN) })
    expect(screen.getByText('Create a new identity')).toBeInTheDocument()
    expect(screen.queryByText('Unlock My Signet Lite')).toBeNull()
  })

  it('auto-locks every session, including one unlocked after an earlier auto-lock', async () => {
    await setupWithPin(M, '123456')
    const id = deriveIdentity(M, 'default')
    await addIdentityRecord({ name: id.name, npub: id.npub, pubkeyHex: id.pubkeyHex })
    render(<App />)

    await enterPinFast('123456')
    await screen.findByText('Your identities')
    await act(async () => { vi.advanceTimersByTime(SIX_MIN) })
    expect(await screen.findByText('Unlock My Signet Lite')).toBeInTheDocument()

    // Sit on the unlock screen a long while (past the 60-minute hard cap from page load), unlock
    // again: the new session must neither lock at once nor stay unlocked forever.
    await act(async () => { vi.advanceTimersByTime(70 * 60_000) })
    await enterPinFast('123456')
    await screen.findByText('Your identities')
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByText('Your identities')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(SIX_MIN) })
    expect(await screen.findByText('Unlock My Signet Lite')).toBeInTheDocument()
  }, 30_000)
})

// L1: a request whose approval lookup is still in flight when the app locks must be denied, never
// shown as a prompt on the locked app, and the app must land on Unlock — never Welcome, whose
// Create/Import would wipe the stored signet with no warning.
describe('App: request arriving mid-lock (L1)', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite') })

  it('denies the request and never shows Welcome or an approval prompt', async () => {
    await setupWithPin(M, '123456')
    const id = deriveIdentity(M, 'default')
    await addIdentityRecord({ name: id.name, npub: id.npub, pubkeyHex: id.pubkeyHex })

    // Capture the real `approve` hook App wires into unlockSession, so the request can be fired
    // directly without needing a live relay/engine round trip.
    let capturedApprove: ((req: unknown) => Promise<{ ok: boolean }>) | null = null
    const realUnlockSession = unlockMod.unlockSession
    const spy = vi.spyOn(unlockMod, 'unlockSession').mockImplementation(async (masterKey, opts) => {
      capturedApprove = opts.approve as (req: unknown) => Promise<{ ok: boolean }>
      return realUnlockSession(masterKey, opts)
    })
    try {
      render(<App />)
      await screen.findByLabelText('PIN entry')
      for (const d of ['1', '2', '3', '4', '5', '6']) {
        fireEvent.click(screen.getByRole('button', { name: d }))
      }
      await screen.findByText('Your identities')
      expect(capturedApprove).not.toBeNull()

      // A request arrives for an app the store has never seen (so it would otherwise prompt).
      // `approve()`'s only await — the IndexedDB app lookup — is still in flight when lock() runs
      // synchronously right after, with no `await` in between: the race window from the review.
      const decisionPromise = capturedApprove!({
        identityName: 'default',
        clientPubkey: 'f'.repeat(64),
        method: 'sign_event',
        eventDetails: { kind: 1, createdAt: 0, tags: [], content: '' },
      })
      fireEvent.click(screen.getByRole('button', { name: /lock now/i }))

      const decision = await decisionPromise
      expect(decision.ok).toBe(false)

      // No approval prompt was ever shown, and the screen is Unlock.
      expect(screen.queryByText('Approve request')).toBeNull()
      expect(await screen.findByText('Unlock My Signet Lite')).toBeInTheDocument()

      // Give any stray post-lock enqueue a chance to land, then re-check: still no prompt, and
      // critically never Welcome (which would let Create/Import wipe the stored signet).
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(screen.queryByText('Approve request')).toBeNull()
      expect(screen.queryByText('Create a new identity')).toBeNull()
      expect(screen.getByText('Unlock My Signet Lite')).toBeInTheDocument()
      expect(await loadMaster()).not.toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})
