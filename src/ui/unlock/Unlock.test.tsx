// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Unlock } from './Unlock'
import { setupWithPin } from '../../app/auth.js'
import * as auth from '../../app/auth.js'
import { __resetDbForTests } from '../../app/db.js'
import { deleteDB } from 'idb'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const PIN = '123456'

afterEach(cleanup)

describe('Unlock', () => {
  beforeEach(async () => {
    await __resetDbForTests()
    await deleteDB('signet-lite')
    await setupWithPin(M, PIN)
  })

  it('calls onUnlocked with a 64-hex master key when the correct PIN is entered', async () => {
    const onUnlocked = vi.fn()
    render(<Unlock biometricAvailable={false} onUnlocked={onUnlocked} onRestore={vi.fn()} />)
    for (const d of ['1', '2', '3', '4', '5', '6']) {
      await userEvent.click(screen.getByRole('button', { name: d }))
    }
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce())
    expect(onUnlocked.mock.calls[0][0]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('shows an unlock error and does not call onUnlocked on a wrong PIN', async () => {
    const onUnlocked = vi.fn()
    render(<Unlock biometricAvailable={false} onUnlocked={onUnlocked} onRestore={vi.fn()} />)
    for (const d of ['0', '0', '0', '0', '0', '0']) {
      await userEvent.click(screen.getByRole('button', { name: d }))
    }
    expect(await screen.findByText(/Couldn't unlock/)).toBeInTheDocument()
    expect(onUnlocked).not.toHaveBeenCalled()
  })

  // M3: a failure after the key is unwrapped (bad stored relay, corrupt record, IDB error) must
  // surface a message and leave the screen usable — not silently ignore every later attempt.
  it('shows an error and stays usable when opening the session fails', async () => {
    const onUnlocked = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined)
    render(<Unlock biometricAvailable={false} onUnlocked={onUnlocked} onRestore={vi.fn()} />)
    for (const d of PIN) await userEvent.click(screen.getByRole('button', { name: d }))
    expect(await screen.findByText(/couldn't open your signet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1' })).not.toBeDisabled()

    for (const d of PIN) await userEvent.click(screen.getByRole('button', { name: d }))
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(2))
  })

  it('offers a recovery-phrase escape hatch that calls onRestore', async () => {
    const onRestore = vi.fn()
    render(<Unlock biometricAvailable={false} onUnlocked={vi.fn()} onRestore={onRestore} />)
    await userEvent.click(screen.getByRole('button', { name: /restore from your recovery phrase/i }))
    expect(onRestore).toHaveBeenCalledOnce()
  })

  it('re-enables PIN entry when secure unlock does not finish', async () => {
    vi.useFakeTimers()
    const unlock = vi.spyOn(auth, 'unlockWithPin').mockImplementation(() => new Promise(() => {}))
    const cancel = vi.spyOn(auth, 'cancelPendingWebAuthnCeremony')

    try {
      render(<Unlock biometricAvailable={false} onUnlocked={vi.fn()} onRestore={vi.fn()} />)
      for (const d of ['1', '2', '3', '4', '5', '6']) {
        fireEvent.click(screen.getByRole('button', { name: d }))
      }

      expect(screen.getByRole('button', { name: '1' })).toBeDisabled()
      expect(screen.getByRole('button', { name: /cancel unlock/i })).toBeInTheDocument()

      await act(async () => {
        vi.advanceTimersByTime(20_000)
      })

      expect(screen.getByText(/Unlock did not finish/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '1' })).not.toBeDisabled()
      expect(cancel).toHaveBeenCalled()
    } finally {
      unlock.mockRestore()
      cancel.mockRestore()
      vi.useRealTimers()
    }
  })

  it('lets the user cancel a stuck secure unlock immediately', async () => {
    const unlock = vi.spyOn(auth, 'unlockWithPin').mockImplementation(() => new Promise(() => {}))
    const cancel = vi.spyOn(auth, 'cancelPendingWebAuthnCeremony')

    try {
      render(<Unlock biometricAvailable={false} onUnlocked={vi.fn()} onRestore={vi.fn()} />)
      for (const d of ['1', '2', '3', '4', '5', '6']) {
        fireEvent.click(screen.getByRole('button', { name: d }))
      }
      fireEvent.click(screen.getByRole('button', { name: /cancel unlock/i }))

      expect(screen.getByText(/Unlock cancelled/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '1' })).not.toBeDisabled()
      expect(cancel).toHaveBeenCalled()
    } finally {
      unlock.mockRestore()
      cancel.mockRestore()
    }
  })
})
