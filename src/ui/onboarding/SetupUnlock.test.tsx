// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetupUnlock } from './SetupUnlock'

afterEach(cleanup)

describe('SetupUnlock', () => {
  it('shows "Turn on Face ID" when biometricAvailable', () => {
    render(<SetupUnlock biometricAvailable onPin={vi.fn()} onBiometric={vi.fn()} />)
    expect(screen.getByText('Turn on Face ID')).toBeInTheDocument()
    expect(screen.queryByLabelText('PIN entry')).not.toBeInTheDocument()
  })

  it('shows the PinPad directly when biometric is not available', () => {
    render(<SetupUnlock biometricAvailable={false} onPin={vi.fn()} onBiometric={vi.fn()} />)
    expect(screen.queryByText('Turn on Face ID')).not.toBeInTheDocument()
    expect(screen.getByLabelText('PIN entry')).toBeInTheDocument()
    expect(screen.getByText(/if someone gets a copy of this browser's data/i)).toBeInTheDocument()
  })

  it('reveals PinPad when "Use a PIN instead" is clicked', async () => {
    render(<SetupUnlock biometricAvailable onPin={vi.fn()} onBiometric={vi.fn()} />)
    await userEvent.click(screen.getByText('Use a PIN instead'))
    expect(screen.getByLabelText('PIN entry')).toBeInTheDocument()
    expect(screen.getByText(/if someone gets a copy of this browser's data/i)).toBeInTheDocument()
  })

  it('calls onBiometric when "Turn on Face ID" is clicked', async () => {
    const onBiometric = vi.fn()
    render(<SetupUnlock biometricAvailable onPin={vi.fn()} onBiometric={onBiometric} />)
    await userEvent.click(screen.getByText('Turn on Face ID'))
    expect(onBiometric).toHaveBeenCalled()
  })
})
