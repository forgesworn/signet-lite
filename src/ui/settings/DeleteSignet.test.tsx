// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeleteSignet } from './DeleteSignet'

afterEach(cleanup)

describe('DeleteSignet', () => {
  it('keeps the delete button disabled until the recovery-phrase box is ticked, then confirms', async () => {
    const onConfirm = vi.fn(), onCancel = vi.fn()
    render(<DeleteSignet onConfirm={onConfirm} onCancel={onCancel} />)

    const del = screen.getByRole('button', { name: /yes, delete everything/i })
    expect(del).toBeDisabled()

    await userEvent.click(screen.getByRole('checkbox', { name: /recovery phrase/i }))
    expect(del).toBeEnabled()

    await userEvent.click(del)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels without deleting', async () => {
    const onConfirm = vi.fn(), onCancel = vi.fn()
    render(<DeleteSignet onConfirm={onConfirm} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
