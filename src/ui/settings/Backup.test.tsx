// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Backup } from './Backup'
import { setupWithPin } from '../../app/auth.js'
import { __resetDbForTests } from '../../app/db.js'
import { deleteDB } from 'idb'

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const NSEC = 'nsec1gc8hf0g9c33lu0qwj3l7dfstpwmrcskljy88zu4dnmv07sq0el8qftpamx'

describe('Backup', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite'); await setupWithPin(M, '123456') })
  afterEach(cleanup)

  it('reveals the recovery phrase after a correct PIN', async () => {
    render(<Backup biometricAvailable={false} onDone={() => {}} />)
    for (const d of '123456') await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${d}$`) }))
    // 'about' is the unique 12th word of the abandon vector — its presence confirms the reveal
    // (the 11 'abandon's would make a single-match query throw, so assert on 'about').
    expect((await screen.findAllByText('about', { exact: false })).length).toBeGreaterThan(0)
  })

  it('shows an error on a wrong PIN and does not reveal', async () => {
    render(<Backup biometricAvailable={false} onDone={() => {}} />)
    for (const d of '000000') await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${d}$`) }))
    expect(await screen.findByText(/wrong pin/i)).toBeInTheDocument()
    expect(screen.queryAllByText('about', { exact: false })).toHaveLength(0)
  })

  it('shows an imported-key message (never the key) for an nsec master', async () => {
    await setupWithPin(NSEC, '123456', 'nsec')   // overrides the mnemonic setup from beforeEach
    render(<Backup biometricAvailable={false} onDone={() => {}} />)
    for (const d of '123456') await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${d}$`) }))
    expect(await screen.findByText(/imported from an nsec/i)).toBeInTheDocument()
    // The nsec itself is never rendered.
    expect(document.body.textContent).not.toMatch(/nsec1/)
  })
})
