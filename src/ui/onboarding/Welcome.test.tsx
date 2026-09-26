// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Welcome } from './Welcome'

describe('Welcome', () => {
  it('renders the brand and both actions', async () => {
    const onCreate = vi.fn()
    const onImport = vi.fn()
    render(<Welcome onCreate={onCreate} onImport={onImport} />)
    expect(screen.getByText('My Signet')).toBeInTheDocument()
    expect(screen.getByText(/Your keys, your identities/)).toBeInTheDocument()
    await userEvent.click(screen.getByText('Create a new identity'))
    expect(onCreate).toHaveBeenCalled()
    await userEvent.click(screen.getByText('I already have a backup'))
    expect(onImport).toHaveBeenCalled()
  })
})
