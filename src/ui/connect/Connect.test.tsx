// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Connect } from './Connect'

afterEach(cleanup)

const VALID_URI = 'nostrconnect://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?relay=wss://r&secret=s&name=Demo&url=https://demo.example'

describe('Connect', () => {
  it('shows the scan/paste and create options on the chooser', () => {
    render(<Connect explain={false} identities={[{ name: 'magazine' }]} onConnect={vi.fn()} onBunker={vi.fn()} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: /scan or paste a link/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create a link for an app/i })).toBeInTheDocument()
  })

  it('parses a pasted URI, shows the confirm screen, and connects with the chosen persona', async () => {
    const onConnect = vi.fn()
    render(<Connect explain={false} identities={[{ name: 'magazine' }]} onConnect={onConnect} onBunker={vi.fn()} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /scan or paste a link/i }))
    await userEvent.type(screen.getByLabelText('Connection link'), VALID_URI)
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByText('Demo')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /connect as magazine/i }))
    expect(onConnect).toHaveBeenCalledWith(VALID_URI, 'magazine', true)
  })

  it('shows an error and stays on the paste step for an invalid URI', async () => {
    render(<Connect explain={false} identities={[{ name: 'magazine' }]} onConnect={vi.fn()} onBunker={vi.fn()} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /scan or paste a link/i }))
    await userEvent.type(screen.getByLabelText('Connection link'), 'not-a-uri')
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByText(/that connection link is not valid/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Connection link')).toBeInTheDocument()
  })

  it('opens the scanner from the paste step and returns to the form on cancel', async () => {
    render(<Connect explain={false} identities={[{ name: 'magazine' }]} onConnect={vi.fn()} onBunker={vi.fn()} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /scan or paste a link/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan qr code/i }))
    expect(await screen.findByRole('heading', { name: /scan the app's qr code/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.getByLabelText('Connection link')).toBeInTheDocument()
  })

  it('picks a persona then creates a link via onBunker', async () => {
    const onBunker = vi.fn()
    render(<Connect explain={false} identities={[{ name: 'magazine' }]} onConnect={vi.fn()} onBunker={onBunker} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /create a link for an app/i }))
    await userEvent.click(screen.getByRole('button', { name: /create link/i }))
    expect(onBunker).toHaveBeenCalledWith('magazine')
  })
})
