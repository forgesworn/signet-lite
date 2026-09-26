// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QrScanner } from './QrScanner'

afterEach(cleanup)

describe('QrScanner', () => {
  it('falls back to a friendly message when the camera is unavailable, and cancels', async () => {
    const onCancel = vi.fn()
    render(<QrScanner accept={() => null} onResult={() => {}} onCancel={onCancel} />)
    // jsdom exposes no navigator.mediaDevices → the component degrades gracefully rather than throwing.
    expect(await screen.findByRole('alert')).toHaveTextContent(/camera isn't available/i)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})
