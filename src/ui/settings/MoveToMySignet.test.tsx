// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { deleteDB } from 'idb'
import { setupWithPin } from '../../app/auth.js'
import { __resetDbForTests } from '../../app/db.js'
import { MoveToMySignet } from './MoveToMySignet'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const NSEC = 'nsec1gc8hf0g9c33lu0qwj3l7dfstpwmrcskljy88zu4dnmv07sq0el8qftpamx'
const IDENTITIES = [
  { name: 'default', displayName: 'Default', npub: 'npub1default' },
  { name: 'work', displayName: 'Work', npub: 'npub1work' },
]

describe('MoveToMySignet', () => {
  beforeEach(async () => {
    await __resetDbForTests()
    await deleteDB('signet-lite')
    await setupWithPin(M, '123456')
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
  })
  afterEach(cleanup)

  it('requires a correct PIN before showing the Lite recovery phrase', async () => {
    render(
      <MoveToMySignet identities={IDENTITIES} biometricAvailable={false} onDone={() => {}} />,
    )

    await userEvent.selectOptions(screen.getByLabelText('Identity'), 'work')
    for (const d of '000000') await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${d}$`) }))
    expect(await screen.findByText(/wrong pin/i)).toBeInTheDocument()

    for (const d of '123456') await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${d}$`) }))
    expect(await screen.findByLabelText(/lite recovery phrase/i)).toHaveValue(M)
    expect(screen.getByLabelText(/lite identity name/i)).toHaveValue('work')
  })

  it('copies the restore details without putting words into the My Signet URL', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(
      <MoveToMySignet identities={IDENTITIES} biometricAvailable={false} onDone={() => {}} />,
    )
    for (const d of '123456') await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${d}$`) }))

    await userEvent.click(await screen.findByRole('button', { name: /copy restore details/i }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining(M))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Lite identity name:\ndefault'))

    await userEvent.click(screen.getByRole('button', { name: /open my signet/i }))
    expect(open).toHaveBeenCalledWith('https://mysignet.app', '_blank', 'noopener,noreferrer')
    expect(JSON.stringify(open.mock.calls)).not.toContain(M)
    open.mockRestore()
  })

  it('auto-hides the revealed recovery phrase after 90 seconds, mirroring Backup', async () => {
    // Real timers throughout (fake timers here hang on this project's real-PBKDF2 unlock flow —
    // see test-setup.ts). Instead, capture the auto-hide setTimeout callback directly and invoke
    // it, so the test doesn't need to wait 90 real seconds.
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')
    try {
      render(
        <MoveToMySignet identities={IDENTITIES} biometricAvailable={false} onDone={() => {}} />,
      )
      for (const d of '123456') await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${d}$`) }))
      expect(await screen.findByLabelText(/lite recovery phrase/i)).toHaveValue(M)

      const hideCall = setTimeoutSpy.mock.calls.find(([, ms]) => ms === 90_000)
      expect(hideCall).toBeDefined()
      await act(async () => { (hideCall![0] as () => void)() })

      expect(screen.queryByLabelText(/lite recovery phrase/i)).not.toBeInTheDocument()
    } finally {
      setTimeoutSpy.mockRestore()
    }
  })

  it('never reveals the nsec for an nsec-imported install - points to the original key instead', async () => {
    await setupWithPin(NSEC, '123456', 'nsec')
    render(
      <MoveToMySignet identities={IDENTITIES} biometricAvailable={false} onDone={() => {}} />,
    )

    await userEvent.selectOptions(screen.getByLabelText('Identity'), 'work')
    for (const d of '123456') await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${d}$`) }))

    // Guidance is shown; the private key is never rendered, copyable, or in the DOM.
    expect(await screen.findByText(/never reveals it/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/nsec for/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copy nsec/i })).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue(NSEC)).not.toBeInTheDocument()
  })
})
