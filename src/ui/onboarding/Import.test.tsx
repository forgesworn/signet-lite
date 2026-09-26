// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { encrypt as nip49Encrypt } from 'nostr-tools/nip49'
import { generateSecretKey } from 'nostr-tools/pure'
import { Import } from './Import'

afterEach(cleanup)

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const NSEC = 'nsec1gc8hf0g9c33lu0qwj3l7dfstpwmrcskljy88zu4dnmv07sq0el8qftpamx'

describe('Import', () => {
  it('enables Continue for a valid phrase + name and passes both up (default name)', async () => {
    const onValid = vi.fn()
    render(<Import onValid={onValid} onBack={vi.fn()} />)
    const phrase = screen.getByLabelText('Recovery phrase')
    await userEvent.type(phrase, 'not a real phrase')
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
    await userEvent.clear(phrase); await userEvent.type(phrase, M)
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onValid).toHaveBeenCalledWith(M, 'default', 'mnemonic')
  })

  it('passes a custom identity name through (the proof path)', async () => {
    const onValid = vi.fn()
    render(<Import onValid={onValid} onBack={vi.fn()} />)
    const name = screen.getByLabelText('Identity name')
    await userEvent.clear(name); await userEvent.type(name, 'passphrase')
    await userEvent.type(screen.getByLabelText('Recovery phrase'), M)
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onValid).toHaveBeenCalledWith(M, 'passphrase', 'mnemonic')
  })

  it('calls onBack when the Back button is clicked', async () => {
    const onBack = vi.fn()
    render(<Import onValid={vi.fn()} onBack={onBack} />)
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })
})

describe('Import — nsec mode', () => {
  it('switches to nsec mode and back via the toggle links', async () => {
    render(<Import onValid={vi.fn()} onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /have an nsec instead/i }))
    expect(screen.getByLabelText('Your nsec')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /use a 12-word phrase instead/i }))
    expect(screen.getByLabelText('Recovery phrase')).toBeInTheDocument()
  })

  it('validates the nsec and passes (nsec, name, "nsec") on Continue', async () => {
    const onValid = vi.fn()
    render(<Import onValid={onValid} onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /have an nsec instead/i }))
    const box = screen.getByLabelText('Your nsec')
    await userEvent.type(box, 'not-an-nsec')
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
    await userEvent.clear(box); await userEvent.type(box, NSEC)
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onValid).toHaveBeenCalledWith(NSEC, 'default', 'nsec')
  })
})

describe('Import — ncryptsec mode', () => {
  it('switches to ncryptsec mode from nsec mode and back', async () => {
    render(<Import onValid={vi.fn()} onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /have an nsec instead/i }))
    await userEvent.click(screen.getByRole('button', { name: /have an encrypted key/i }))
    expect(screen.getByLabelText('Encrypted key (ncryptsec)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /use a plain nsec instead/i }))
    expect(screen.getByLabelText('Your nsec')).toBeInTheDocument()
  })

  it('decrypts with the correct password and calls onValid with an nsec1 string and "nsec"', async () => {
    const sk = generateSecretKey()
    const ncryptsec = nip49Encrypt(sk, 'hunter2')
    const onValid = vi.fn()
    render(<Import onValid={onValid} onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /have an nsec instead/i }))
    await userEvent.click(screen.getByRole('button', { name: /have an encrypted key/i }))
    await userEvent.type(screen.getByLabelText('Encrypted key (ncryptsec)'), ncryptsec)
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2')
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onValid).toHaveBeenCalledTimes(1)
    const [secret, , kind] = onValid.mock.calls[0]
    expect(kind).toBe('nsec')
    expect(secret).toMatch(/^nsec1/)
  })

  it('shows an error and does NOT call onValid when the password is wrong', async () => {
    const ncryptsec = nip49Encrypt(generateSecretKey(), 'right')
    const onValid = vi.fn()
    render(<Import onValid={onValid} onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /have an nsec instead/i }))
    await userEvent.click(screen.getByRole('button', { name: /have an encrypted key/i }))
    await userEvent.type(screen.getByLabelText('Encrypted key (ncryptsec)'), ncryptsec)
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onValid).not.toHaveBeenCalled()
    expect(screen.getByText(/that password did not unlock/i)).toBeInTheDocument()
  })

  it('reveal toggle switches the password field between type="password" and type="text"', async () => {
    render(<Import onValid={vi.fn()} onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /have an nsec instead/i }))
    await userEvent.click(screen.getByRole('button', { name: /have an encrypted key/i }))

    const passwordInput = screen.getByLabelText('Password')
    expect(passwordInput).toHaveAttribute('type', 'password')

    const revealBtn = screen.getByRole('button', { name: /show password/i })
    await userEvent.click(revealBtn)
    expect(passwordInput).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: /hide password/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /hide password/i }))
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: /show password/i })).toBeInTheDocument()
  })
})
