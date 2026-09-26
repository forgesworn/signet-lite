// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecoveryPhrase } from './RecoveryPhrase'

const WORDS = ['voyage','lemon','brisk','anchor','fabric','simple','gather','oxygen','ritual','velvet','shadow','custom']

describe('RecoveryPhrase', () => {
  it('renders all 12 words and fires onContinue', async () => {
    const onContinue = vi.fn()
    render(<RecoveryPhrase words={WORDS} onContinue={onContinue} />)
    for (const word of WORDS) expect(screen.getByText(word)).toBeInTheDocument()
    await userEvent.click(screen.getByText("I've written them down"))
    expect(onContinue).toHaveBeenCalled()
  })
})
