// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PinPad } from './PinPad'

describe('PinPad', () => {
  it('calls onComplete with the 6 digits entered', async () => {
    const onComplete = vi.fn()
    render(<PinPad onComplete={onComplete} />)
    for (const d of ['1','2','3','4','5','6']) await userEvent.click(screen.getByRole('button', { name: d }))
    expect(onComplete).toHaveBeenCalledWith('123456')
  })
})
