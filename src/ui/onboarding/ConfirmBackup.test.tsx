// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmBackup } from './ConfirmBackup'

const WORDS = ['voyage','lemon','brisk','anchor','fabric','simple','gather','oxygen','ritual','velvet','shadow','custom']

afterEach(cleanup)

describe('ConfirmBackup', () => {
  it('Confirm is disabled until inputs are filled', () => {
    render(<ConfirmBackup words={WORDS} picks={[1, 10]} onConfirmed={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  })

  it('Confirm stays disabled with wrong answers and shows an error', async () => {
    const onConfirmed = vi.fn()
    render(<ConfirmBackup words={WORDS} picks={[1, 10]} onConfirmed={onConfirmed} />)
    // picks [1,10] → words[1]='lemon', words[10]='shadow'
    await userEvent.type(screen.getByLabelText('Word #2'), 'lemon')
    await userEvent.type(screen.getByLabelText('Word #11'), 'velvet') // wrong
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onConfirmed).not.toHaveBeenCalled()
    expect(screen.getByText(/That doesn't match/)).toBeInTheDocument()
  })

  it('fires onConfirmed when correct answers are entered', async () => {
    const onConfirmed = vi.fn()
    render(<ConfirmBackup words={WORDS} picks={[1, 10]} onConfirmed={onConfirmed} />)
    await userEvent.type(screen.getByLabelText('Word #2'), 'lemon')
    await userEvent.type(screen.getByLabelText('Word #11'), 'shadow')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onConfirmed).toHaveBeenCalled()
  })
})
