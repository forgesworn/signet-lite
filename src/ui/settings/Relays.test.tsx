// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Relays } from './Relays'

afterEach(cleanup)

const baseProps = { relays: ['wss://a', 'wss://b'], onAdd: () => {}, onRemove: () => {}, onBack: () => {}, blossomServer: 'https://blossom.band', onSetBlossom: () => {} }

describe('Relays', () => {
  it('adds and removes relays', async () => {
    const onAdd = vi.fn(), onRemove = vi.fn()
    render(<Relays {...baseProps} onAdd={onAdd} onRemove={onRemove} />)
    await userEvent.type(screen.getByLabelText('Add relay'), 'wss://c')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(onAdd).toHaveBeenCalledWith('wss://c')
    await userEvent.click(screen.getAllByRole('button', { name: /remove/i })[0])
    expect(onRemove).toHaveBeenCalledWith('wss://a')
  })

  it('edits the Blossom image server (saved on blur)', async () => {
    const onSetBlossom = vi.fn()
    render(<Relays {...baseProps} onSetBlossom={onSetBlossom} />)
    const input = screen.getByLabelText('Image server')
    expect(input).toHaveValue('https://blossom.band')
    await userEvent.clear(input)
    await userEvent.type(input, 'https://my.blossom')
    input.blur()
    expect(onSetBlossom).toHaveBeenCalledWith('https://my.blossom')
  })

  it('shows a specific Blossom image server error', () => {
    render(<Relays {...baseProps} blossomError="Enter a valid https:// image server URL." />)
    expect(screen.getByRole('alert')).toHaveTextContent(/valid https:\/\/ image server/i)
  })
})
